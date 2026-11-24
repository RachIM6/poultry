"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId, useState, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { formatKg, formatMoney } from "@/lib/format";
import { parseCentimes } from "@/lib/kernel/money";
import { budgetCash, budgetOf, plainTiming, type BudgetInputs, type CashTiming } from "@/modules/finance/shared";
import { parseQuantity } from "@/modules/inventory/shared";
import { field, primary, table } from "@/components/ui";

// SPEC-finance FN15: a planned batch's budget, copied from a closed batch, with its feed and sale prices as what-if
// inputs. The figures recompute on every keystroke with the same pure function the server uses.


type TimingText = { lastDay: number; feed: [number, string][]; other: [number, string][]; sales: [number, string][] };
type Base = { batchId: string; label: string; inputs: Record<keyof BudgetInputs, string>; timing: TimingText }; // centimes and grams as strings
type Text = Record<keyof BudgetInputs, string>;
export type SaveState = { ok?: boolean; messageKey?: string };

// What the farmer types: DH with centimes, kg with grams, whole chicks.
const dh = (c: string) => {
  const v = BigInt(c);
  return `${v / 100n},${String(v % 100n).padStart(2, "0")}`;
};
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

const weights = (w: [number, string][]): CashTiming["feed"] => w.map(([d, x]) => [d, BigInt(x)]);
const timingOf = (t: TimingText): CashTiming => ({ lastDay: t.lastDay, feed: weights(t.feed), other: weights(t.other), sales: weights(t.sales) });

/** The typed values, or null while one of them doesn't parse. */
function parse(t: Text): BudgetInputs | null {
  const money = (s: string) => parseCentimes(s);
  const grams = (s: string) => {
    const g = parseQuantity(s, "kg");
    return g === null ? null : BigInt(g);
  };
  const chicks = /^\d{1,9}$/.test(t.chicks.trim()) ? BigInt(t.chicks.trim()) : null;
  const v = {
    chicks,
    chickPriceCentimes: money(t.chickPriceCentimes),
    feedGrams: grams(t.feedGrams),
    feedPricePerKgCentimes: money(t.feedPricePerKgCentimes),
    otherCostCentimes: money(t.otherCostCentimes),
    plannedGrams: grams(t.plannedGrams),
    salePricePerKgCentimes: money(t.salePricePerKgCentimes),
  };
  return Object.values(v).every((x) => x !== null) ? (v as BudgetInputs) : null;
}

export function BudgetPlanner({ bases, batches, save }: { bases: Base[]; batches: { batchId: string; label: string }[]; save: (state: SaveState, form: FormData) => Promise<SaveState> }) {
  const t = useTranslations("Budget");
  const tr = useTranslations();
  const [id, setId] = useState(() => uuidv7()); // SPEC §7: a double submit sends the same id, saved once
  const [basedOn, setBasedOn] = useState(bases[0]?.batchId ?? "");
  const [text, setText] = useState<Text>(bases[0] ? toText(bases[0].inputs) : EMPTY);
  const [state, action, pending] = useActionState(async (s: SaveState, form: FormData) => {
    const saved = await save(s, form);
    if (saved.ok) setId(uuidv7()); // the next budget is a new one
    return saved;
  }, {});
  const [saleDay, setSaleDay] = useState(""); // without a base batch: when the sale is planned (§9 "Budget cash need")
  const inputs = parse(text);
  const b = inputs && budgetOf(inputs);
  const base = bases.find((x) => x.batchId === basedOn);
  const timing = base ? timingOf(base.timing) : /^\d{1,3}$/.test(saleDay.trim()) ? plainTiming(Number(saleDay.trim())) : null;
  const cash = inputs && timing && budgetCash(inputs, timing);

  const set = (k: keyof Text) => (e: { target: { value: string } }) => setText({ ...text, [k]: e.target.value });
  const pick = (id: string) => {
    setBasedOn(id);
    const base = bases.find((x) => x.batchId === id);
    if (base) setText(toText(base.inputs));
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
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("chicks")}>{(id) => <input id={id} value={text.chicks} onChange={set("chicks")} inputMode="numeric" dir="ltr" className={field} />}</Field>
        <Field label={t("chickPrice")}>{(id) => <input id={id} value={text.chickPriceCentimes} onChange={set("chickPriceCentimes")} inputMode="decimal" dir="ltr" className={field} />}</Field>
        <Field label={t("feedKg")}>{(id) => <input id={id} value={text.feedGrams} onChange={set("feedGrams")} inputMode="decimal" dir="ltr" className={field} />}</Field>
        <Field label={t("feedPrice")}>{(id) => <input id={id} value={text.feedPricePerKgCentimes} onChange={set("feedPricePerKgCentimes")} inputMode="decimal" dir="ltr" className={field} />}</Field>
        <Field label={t("other")}>{(id) => <input id={id} value={text.otherCostCentimes} onChange={set("otherCostCentimes")} inputMode="decimal" dir="ltr" className={field} />}</Field>
        <Field label={t("plannedKg")}>{(id) => <input id={id} value={text.plannedGrams} onChange={set("plannedGrams")} inputMode="decimal" dir="ltr" className={field} />}</Field>
        <Field label={t("salePrice")}>{(id) => <input id={id} value={text.salePricePerKgCentimes} onChange={set("salePricePerKgCentimes")} inputMode="decimal" dir="ltr" className={field} />}</Field>
      </div>

      {b && inputs ? (
        <dl className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-card p-3" aria-label={t("figures")} aria-live="polite">
          <dt>{t("plannedCost")}</dt>
          <dd dir="ltr" className="text-end tabular-nums">{formatMoney(b.plannedCostCentimes)}</dd>
          <dt>{t("breakEven")}</dt>
          <dd dir="ltr" className="text-end font-semibold tabular-nums">{b.breakEvenPerKgCentimes === null ? "—" : `${formatMoney(b.breakEvenPerKgCentimes)} / kg`}</dd>
          <dt>{t("plannedSales")}</dt>
          <dd dir="ltr" className="text-end tabular-nums">{formatMoney(b.plannedSalesCentimes)} ({formatKg(Number(inputs.plannedGrams))})</dd>
          <dt>{t("plannedMargin")}</dt>
          <dd dir="ltr" className="text-end font-semibold tabular-nums">{formatMoney(b.plannedMarginCentimes)}</dd>
        </dl>
      ) : (
        <p role="alert">{tr("errors.INVALID_INPUT")}</p>
      )}

      {/* SPEC-finance FN15, §9 "Budget cash need": the batch's cash week by week, from the base batch's timing or the plain rule */}
      <section className="flex flex-col gap-2" aria-labelledby="budget-cash">
        <h2 id="budget-cash" className="text-[17px] font-semibold text-ink-2">{t("cash")}</h2>
        {!base && <Field label={t("saleDay")}>{(id) => <input id={id} value={saleDay} onChange={(e) => setSaleDay(e.target.value)} inputMode="numeric" dir="ltr" className={field} />}</Field>}
        {cash ? (
          <>
            <p className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl border border-line bg-card p-3" aria-live="polite">
              <span>
                {t("peakNeed")}
                {cash.peakWeek !== null && <span className="text-sm text-ink-2"> · {t("peakWeek", { week: cash.peakWeek })}</span>}
              </span>
              <bdi dir="ltr" className="text-xl font-semibold tabular-nums">{formatMoney(cash.peakNeedCentimes)}</bdi>
            </p>
            <table className={table} aria-label={t("cash")}>
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-start">{t("week")}</th>
                  <th scope="col" className="p-2 text-end">{t("outflow")}</th>
                  <th scope="col" className="p-2 text-end">{t("inflow")}</th>
                  <th scope="col" className="p-2 text-end">{t("cumulative")}</th>
                </tr>
              </thead>
              <tbody>
                {cash.weeks.map((w) => (
                  <tr key={w.week} className={`border-t border-line ${w.week === cash.peakWeek ? "font-semibold" : ""}`}>
                    <th scope="row" className="p-2 text-start font-normal">{w.week}</th>
                    <td dir="ltr" className="p-2 text-end tabular-nums">{w.outCentimes === 0n ? "" : formatMoney(w.outCentimes)}</td>
                    <td dir="ltr" className="p-2 text-end tabular-nums">{w.inCentimes === 0n ? "" : formatMoney(w.inCentimes)}</td>
                    <td dir="ltr" className={`p-2 text-end tabular-nums ${w.cumulativeCentimes < 0n ? "text-brick-fg" : ""}`}>{formatMoney(w.cumulativeCentimes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-ink-2">{t(base ? "cashFromBase" : "cashPlain")} {t("cashNote")}</p>
          </>
        ) : (
          inputs && <p className="text-sm text-ink-2">{t("saleDayMissing")}</p>
        )}
      </section>

      {/* What the server saves: the parsed inputs, in centimes and grams. */}
      {inputs && Object.entries(inputs).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      <Field label={t("name")}>{(id) => <input id={id} name="name" required maxLength={80} className={field} />}</Field>
      {state.messageKey && <p role={state.ok ? "status" : "alert"}>{tr(state.messageKey)}</p>}
      <button type="submit" disabled={!inputs || pending} className={primary}>{t("save")}</button>
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
