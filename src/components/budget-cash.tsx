import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/format";
import type { BudgetCash } from "@/modules/finance/shared";
import { table } from "@/components/ui";

// SPEC-finance FN15, §9 "Budget cash need": a budget's peak cash need and its weeks. No "use client": the planner
// renders it live, the saved budgets' list on the server.
export function BudgetCashView({ cash, label, fromBase, live = false }: { cash: BudgetCash; label: string; fromBase: boolean; live?: boolean }) {
  const t = useTranslations("Budget");
  return (
    <>
      <p className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl border border-line bg-card p-3" aria-live={live ? "polite" : undefined}>
        <span>{t("peakNeed")}</span>{" "}
        <span>
          {cash.peakWeek !== null && <span className="text-sm text-ink-2">{t("peakWeek", { week: cash.peakWeek })} · </span>}
          <bdi dir="ltr" className="text-xl font-semibold tabular-nums">{formatMoney(cash.peakNeedCentimes)}</bdi>
        </span>
      </p>
      {/* A phone is narrower than three amounts side by side: the table scrolls, never the page */}
      <div className="overflow-x-auto">
        <table className={table} aria-label={label}>
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
      </div>
      <p className="text-sm text-ink-2">{t(fromBase ? "cashFromBase" : "cashPlain")} {t("cashNote")}</p>
    </>
  );
}
