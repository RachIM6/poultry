import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BudgetPlanner } from "@/components/budget";
import { redirect } from "@/i18n/navigation";
import { formatMoney } from "@/lib/format";
import { budgetBases, budgetBatches, budgetOf, listBudgets } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { saveBudgetAction } from "./actions";
import { BackLink } from "@/components/app-nav";

// SPEC-finance FN15: plan the next batch from a closed one, with what-if feed and sale prices. Online, owner and manager.
export default function BudgetPage() {
  return (
    <>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Budget />
        </Suspense>
      </main>
    </>
  );
}

const asText = <T extends Record<string, bigint>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as Record<keyof T, string>;

async function Budget() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const [bases, batches, saved] = await Promise.all([budgetBases(ctx.value), budgetBatches(ctx.value), listBudgets(ctx.value)]);
  if (!bases.ok || !batches.ok || !saved.ok) return <p>{t("Expenses.forbidden")}</p>;
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Budget.title")}</h1>
      <BudgetPlanner bases={bases.value.map((b) => ({ batchId: b.batchId, label: b.label, inputs: asText(b.inputs) }))} batches={batches.value} save={saveBudgetAction} />
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Budget.saved")}</h2>
      {saved.value.length === 0 ? (
        <p>{t("Budget.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("Budget.saved")}>
          {saved.value.map((s) => {
            const b = budgetOf(s.inputs);
            return (
              <li key={s.id} className="rounded-2xl border border-line bg-card p-3">
                <span className="font-semibold">{s.name}</span> ·{" "}
                {t("Budget.line", {
                  breakEven: b.breakEvenPerKgCentimes === null ? "—" : formatMoney(b.breakEvenPerKgCentimes),
                  margin: formatMoney(b.plannedMarginCentimes),
                })}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
