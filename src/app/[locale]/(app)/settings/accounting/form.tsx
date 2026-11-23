"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { saveAccountingAction } from "./actions";
import { field, primary } from "@/components/ui";

type Props = {
  legalEntityId: string;
  books: string;
  booksAllowed: string[];
  pca: boolean;
  month: number;
  months: string[];
  vatRegistered: boolean;
  hensMethod: string;
  locked: boolean;
};

const Choice = ({ name, value, checked, title, desc, disabled }: { name: string; value: string; checked: boolean; title: string; desc: string; disabled: boolean }) => (
  <label className="flex items-start gap-3 rounded-[18px] border border-line bg-card p-4 has-checked:border-ink">
    <input type="radio" name={name} value={value} defaultChecked={checked} disabled={disabled} className="mt-1.5 size-5 shrink-0 accent-ink" />
    <span className="flex flex-col gap-1">
      <span className="font-semibold">{title}</span>
      <span className="text-sm text-ink-2">{desc}</span>
    </span>
  </label>
);

/** SPEC-finance FN1, FN9 (F-Profile), FC6: the books, the chart, the fiscal year, VAT and the laying hens' method, while the year has no entry. */
export function AccountingForm(p: Props) {
  const t = useTranslations("Accounting");
  const tAll = useTranslations();
  const [state, action, pending] = useActionState(saveAccountingAction, {});
  const off = p.locked || pending;
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="legalEntityId" value={p.legalEntityId} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-lg font-semibold">{t("books")}</legend>
        {p.booksAllowed.map((b) => (
          <Choice key={b} name="books" value={b} checked={p.books === b} title={t(`booksOptions.${b}.title`)} desc={t(`booksOptions.${b}.desc`)} disabled={off} />
        ))}
        {p.booksAllowed.length === 1 && <p className="text-sm text-ink-2">{t("ledgerRequired")}</p>}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-lg font-semibold">{t("chart")}</legend>
        <Choice name="chart" value="pca" checked={p.pca} title={t("charts.pca.title")} desc={t("charts.pca.desc")} disabled={off} />
        <Choice name="chart" value="cgnc" checked={!p.pca} title={t("charts.cgnc.title")} desc={t("charts.cgnc.desc")} disabled={off} />
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-lg font-semibold">{t("yearStart")}</span>
        <select name="month" defaultValue={p.month} disabled={off} className={field}>
          {p.months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-lg font-semibold">{t("vat")}</legend>
        <label className="flex items-center gap-3">
          <input type="checkbox" name="vatRegistered" defaultChecked={p.vatRegistered} disabled={off} className="size-5 accent-ink" />
          {t("vatRegistered")}
        </label>
        <p className="text-sm text-ink-2">{t("vatHint")}</p>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-lg font-semibold">{t("hens")}</legend>
        {["classic", "simplified"].map((m) => (
          <Choice key={m} name="hensMethod" value={m} checked={p.hensMethod === m} title={t(`hensMethods.${m}.title`)} desc={t(`hensMethods.${m}.desc`)} disabled={off} />
        ))}
      </fieldset>
      {state.messageKey && <p role={state.ok ? "status" : "alert"}>{tAll(state.messageKey)}</p>}
      <button type="submit" disabled={off} className={primary}>{t("save")}</button>
    </form>
  );
}
