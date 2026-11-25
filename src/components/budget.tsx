"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useId, useState, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { formatKg, formatMoney } from "@/lib/format";
import { parseCentimes, typedCentimes } from "@/lib/kernel/money";
import { budgetCash, budgetOf, plainTiming, type BudgetInputs, type CashTiming, type PaymentDelays } from "@/modules/finance/shared";
import { parseQuantity } from "@/modules/inventory/shared";
import { OfflineHint, unsent, useOnline } from "@/components/online";
import { danger, field, primary } from "@/components/ui";
import { BudgetCashView } from "@/components/budget-cash";

// SPEC-finance FN15: a planned batch's budget, copied from a closed batch, with its feed and sale prices as what-if
// inputs. The figures recompute on every keystroke with the same pure function the server uses; a screen reader hears
// them, and the fields to check, when the user leaves a field (WCAG 4.1.3), not on each keystroke.


type TimingText = { lastDay: number; feed: [number, string][]; other: [number, string][]; sales: [number, string][] };
type Base = { batchId: string; label: string; inputs: Record<keyof BudgetInputs, string>; timing: TimingText }; // centimes and grams as strings
type Text = Record<keyof BudgetInputs, string>;
export type SaveState = { ok?: boolean; messageKey?: string };

// What the farmer types: DH with centimes, kg with grams, whole chicks.
const dh = (c: string) => typedCentimes(BigInt(c));
const kg = (g: string) => {
  const v = BigInt(g);
  return v % 1000n === 0n ? String(v / 1000n) : `${v / 1000n},${String(v % 1000n).padStart(3, "0")}`;
};
const toText = (i: Base["inputs"]): Text => ({
  chicks: i.chicks,
  chickPriceCentimes: dh(i.chickPriceCentimes),
  feedGrams: kg(i.feedGrams),
  feedPricePerKgCentimes: dh(i.feedPricePerKgCentimes),
  otherCostCentimes: dh(i.otherCostCentimes),
  plannedGrams: kg(i.plannedGrams),
  salePricePerKgCentimes: dh(i.salePricePerKgCentimes),
});
const EMPTY: Text = { chicks: "", chickPriceCentimes: "", feedGrams: "", feedPricePerKgCentimes: "", otherCostCentimes: "", plannedGrams: "", salePricePerKgCentimes: "" };

const grams = (s: string) => {
  const g = parseQuantity(s, "kg");
  return g === null ? null : BigInt(g);
};
const PARSE: Record<keyof Text, (s: string) => bigint | null> = {
  chicks: (s) => (/^\d{1,9}$/.test(s.trim()) ? BigInt(s.trim()) : null),
  chickPriceCentimes: parseCentimes,
  feedGrams: grams,
  feedPricePerKgCentimes: parseCentimes,
  otherCostCentimes: parseCentimes,
  plannedGrams: grams,
  salePricePerKgCentimes: parseCentimes,
};
/** Each field's label, in the form's order. */
const LABEL: Record<keyof Text, string> = { chicks: "chicks", chickPriceCentimes: "chickPrice", feedGrams: "feedKg", feedPricePerKgCentimes: "feedPrice", otherCostCentimes: "other", plannedGrams: "plannedKg", salePricePerKgCentimes: "salePrice" };
const KEYS = Object.keys(LABEL) as (keyof Text)[];

/** The fields that don't parse. */
const unread = (t: Text) => KEYS.filter((k) => PARSE[k](t[k]) === null);

const weights = (w: [number, string][]): CashTiming["feed"] => w.map(([d, x]) => [d, BigInt(x)]);
const timingOf = (t: TimingText): CashTiming => ({ lastDay: t.lastDay, feed: weights(t.feed), other: weights(t.other), sales: weights(t.sales) });

/** The typed values, or null while one of them doesn't parse. */
function parse(t: Text): BudgetInputs | null {
  return unread(t).length > 0 ? null : (Object.fromEntries(KEYS.map((k) => [k, PARSE[k](t[k])])) as BudgetInputs);
}

/** A typed supplier delay: whole days, 0–999; empty, the farm's own. Null: doesn't read. */
const delayOf = (s: string, own: number) => (s.trim() === "" ? own : /^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : null);
const DELAYS = [["chicks", "chickPaymentDays", "chickDelay"], ["feed", "feedPaymentDays", "feedDelay"]] as const;

/**
 * Without `save` (the accountant reads, SPEC-m5 PA5), the same what-if without the name and the button. `delays`: the
 * farm's own supplier delays (§9 "Budget cash need"), the delay fields' first values.
 */
export function BudgetPlanner({ bases, batches, delays, save }: { bases: Base[]; batches: { batchId: string; label: string }[]; delays: PaymentDelays; save?: (state: SaveState, form: FormData) => Promise<SaveState> }) {
  const t = useTranslations("Budget");
  const tr = useTranslations();
  const [id, setId] = useState(() => uuidv7()); // SPEC §7: a double submit sends the same id, saved once
  const [basedOn, setBasedOn] = useState(bases[0]?.batchId ?? "");
  const [text, setText] = useState<Text>(bases[0] ? toText(bases[0].inputs) : EMPTY);
  const [state, action, pending] = useActionState(async (s: SaveState, form: FormData) => {
    const saved = save ? await unsent(save(s, form)) : s; // failed, the typed figures stay
    if (saved.ok) setId(uuidv7()); // the next budget is a new one
    return saved;
  }, {});
  const online = useOnline();
  const [saleDay, setSaleDay] = useState(""); // without a base batch: when the sale is planned (§9 "Budget cash need")
  const inputs = parse(text);
  const b = inputs && budgetOf(inputs);
  const base = bases.find((x) => x.batchId === basedOn);
  const saleDayOk = /^\d{1,3}$/.test(saleDay.trim());
  const [delayText, setDelayText] = useState({ chicks: String(delays.chicks), feed: String(delays.feed) });
  const typedDelays = { chicks: delayOf(delayText.chicks, delays.chicks), feed: delayOf(delayText.feed, delays.feed) };
  const delaysOk = typedDelays.chicks !== null && typedDelays.feed !== null;
  const delayHint = useId();
  const timing = base ? timingOf(base.timing) : saleDayOk ? plainTiming(Number(saleDay.trim())) : null;
  const saleDayHint = useId();
  const cash = inputs && timing && delaysOk && budgetCash(inputs, timing, typedDelays as PaymentDelays);
  const errorId = useId();
  const list = new Intl.ListFormat(useLocale() === "ar" ? "ar" : "fr"); // "a, b et c" in French
  // Set when the user leaves a field: the fields to check, else the result to say.
  const [checked, setChecked] = useState<{ bad: (keyof Text)[]; said: string }>({ bad: [], said: "" });
  const check = () =>
    setChecked({
      bad: unread(text),
      said: b ? t("line", { breakEven: b.breakEvenPerKgCentimes === null ? "—" : formatMoney(b.breakEvenPerKgCentimes), margin: formatMoney(b.plannedMarginCentimes) }) : "",
    });

  const set = (k: keyof Text) => (e: { target: { value: string } }) => setText({ ...text, [k]: e.target.value });
  const pick = (id: string) => {
    setBasedOn(id);
    const base = bases.find((x) => x.batchId === id);
    if (base) setText(toText(base.inputs));
    setChecked({ bad: [], said: "" });
  };

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t("basedOn")}>
        {(id) => (
          <select id={id} value={basedOn} onChange={(e) => pick(e.target.value)} className={field}>
            {bases.map((x) => <option key={x.batchId} value={x.batchId}>{x.label}</option>)}
            <option value="">{t("blank")}</option>
          </select>
        )}
      </Field>
      <input type="hidden" name="basedOn" value={basedOn} />
      <input type="hidden" name="id" value={id} />
      {/* FN17: a budget linked to an open batch plans only what it hasn't sold yet (SPEC-finance §9 FQ32). */}
      <Field label={t("batch")}>
        {(fieldId) => (
          <select id={fieldId} name="batchId" defaultValue="" className={field}>
            <option value="">{t("noBatch")}</option>
            {batches.map((x) => <option key={x.batchId} value={x.batchId}>{x.label}</option>)}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3" onBlur={check}>
        {KEYS.map((k) => {
          const bad = checked.bad.includes(k);
          return (
            <Field key={k} label={t(LABEL[k])}>
              {(id) => (
                <input id={id} value={text[k]} onChange={set(k)} inputMode={k === "chicks" ? "numeric" : "decimal"} dir="ltr" aria-invalid={bad || undefined} aria-describedby={bad ? errorId : undefined} className={`${field} aria-invalid:border-alert`} />
              )}
            </Field>
          );
        })}
      </div>
      {checked.bad.length > 0 && (
        <p id={errorId} role="alert" className={danger}>
          {t("check", { fields: list.format(checked.bad.map((k) => t(LABEL[k]))) })}
        </p>
      )}
      <p role="status" className="sr-only">{checked.bad.length === 0 && checked.said}</p>

      {b && inputs && (
        <dl className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-card p-3" aria-label={t("figures")}>
          <dt>{t("plannedCost")}</dt>
          <dd className="text-end tabular-nums"><bdi dir="ltr">{formatMoney(b.plannedCostCentimes)}</bdi></dd>
          <dt>{t("breakEven")}</dt>
          <dd className="text-end font-semibold tabular-nums"><bdi dir="ltr">{b.breakEvenPerKgCentimes === null ? "—" : `${formatMoney(b.breakEvenPerKgCentimes)} / kg`}</bdi></dd>
          <dt>{t("plannedSales")}</dt>
          <dd className="text-end tabular-nums"><bdi dir="ltr">{formatMoney(b.plannedSalesCentimes)} ({formatKg(Number(inputs.plannedGrams))})</bdi></dd>
          <dt>{t("plannedMargin")}</dt>
          <dd className="text-end font-semibold tabular-nums"><bdi dir="ltr">{formatMoney(b.plannedMarginCentimes)}</bdi></dd>
        </dl>
      )}

      {/* SPEC-finance FN15, §9 "Budget cash need": the batch's cash week by week, from the base batch's timing or the plain rule */}
      <section className="flex flex-col gap-2" aria-labelledby="budget-cash">
        <h2 id="budget-cash" className="text-[17px] font-semibold text-ink-2">{t("cash")}</h2>
        <div className="grid grid-cols-2 gap-3">
          {DELAYS.map(([k, name, label]) => (
            <Field key={k} label={t(label)}>
              {(id) => <input id={id} name={name} value={delayText[k]} onChange={(e) => setDelayText({ ...delayText, [k]: e.target.value })} inputMode="numeric" dir="ltr" aria-invalid={typedDelays[k] === null || undefined} aria-describedby={delayHint} className={`${field} aria-invalid:border-alert`} />}
            </Field>
          ))}
        </div>
        <p id={delayHint} className="text-sm text-ink-2">{t(delaysOk ? "delayHint" : "delayCheck")}</p>
        {!base && <Field label={t("saleDay")}>{(id) => <input id={id} name="saleDay" value={saleDay} onChange={(e) => setSaleDay(e.target.value)} inputMode="numeric" dir="ltr" aria-invalid={(saleDay.trim() !== "" && !saleDayOk) || undefined} aria-describedby={cash || !delaysOk ? undefined : saleDayHint} className={`${field} aria-invalid:border-alert`} />}</Field>}
        {cash ? (
          <BudgetCashView cash={cash} label={t("cash")} fromBase={!!base} />
        ) : (
          inputs && delaysOk && <p id={saleDayHint} className="text-sm text-ink-2">{t("saleDayMissing")}</p>
        )}
      </section>

      {/* What the server saves: the parsed inputs, in centimes and grams. */}
      {inputs && Object.entries(inputs).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      {save && (
        <>
          <Field label={t("name")}>{(id) => <input id={id} name="name" required maxLength={80} className={field} />}</Field>
          {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{tr(state.messageKey)}</p>}
          <OfflineHint online={online} />
          <button type="submit" disabled={!inputs || pending || !online} className={primary}>{t("save")}</button>
        </>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}
