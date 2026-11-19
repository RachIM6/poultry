"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId, useState, type ReactNode } from "react";
import { formatKg, formatMoney } from "@/lib/format";
import { parseCentimes } from "@/lib/kernel/money";
import { budgetOf, type BudgetInputs } from "@/modules/finance/shared";
import { parseQuantity } from "@/modules/inventory/shared";
import { field, primary } from "@/components/ui";

// SPEC-finance FN15: a planned batch's budget, copied from a closed batch, with its feed and sale prices as what-if
// inputs. The figures recompute on every keystroke with the same pure function the server uses.


type Base = { batchId: string; label: string; inputs: Record<keyof BudgetInputs, string> }; // centimes and grams as strings
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

export function BudgetPlanner({ bases, save }: { bases: Base[]; save: (state: SaveState, form: FormData) => Promise<SaveState> }) {
  const t = useTranslations("Budget");
  const tr = useTranslations();
  const [basedOn, setBasedOn] = useState(bases[0]?.batchId ?? "");
  const [text, setText] = useState<Text>(bases[0] ? toText(bases[0].inputs) : EMPTY);
  const [state, action, pending] = useActionState(save, {});
  const inputs = parse(text);
  const b = inputs && budgetOf(inputs);

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
