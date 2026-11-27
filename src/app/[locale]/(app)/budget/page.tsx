import { headers } from "next/headers";
import { locale } from "next/root-params";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BudgetPlanner } from "@/components/budget";
import { BudgetCashView } from "@/components/budget-cash";
import { redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { budgetBases, budgetBatches, budgetCash, budgetPaymentDelays, budgetOf, listBudgets, plainTiming, type CashTiming } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { saveBudgetAction } from "./actions";
import { Page } from "@/components/page";
import { Num } from "@/components/num";
import { dataTable, dataTableWrap, empty, sectionTitle } from "@/components/layout";
import { ResultsTabs } from "../results/results-tabs";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Budget", "Nav", "Offline", "Sync.refused", "errors"];

// SPEC-finance FN15: plan the next batch from a closed one, with what-if feed and sale prices. Online, owner and manager.
export default function BudgetPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Results.section")} nav={<ResultsTabs current="budget" />}>
        <Suspense>
          <Budget />
        </Suspense>
      </Page>
    </ClientMessages>
  );
}

const asText = <T extends Record<string, bigint>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as Record<keyof T, string>;
const weightsText = (w: CashTiming["feed"]): [number, string][] => w.map(([d, x]) => [d, String(x)]);
const timingText = (t: CashTiming) => ({ lastDay: t.lastDay, feed: weightsText(t.feed), other: weightsText(t.other), sales: weightsText(t.sales) });

async function Budget() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const [bases, batches, saved, delays] = await Promise.all([budgetBases(ctx.value), budgetBatches(ctx.value), listBudgets(ctx.value), budgetPaymentDelays(ctx.value)]);
  if (!bases.ok || !batches.ok || !saved.ok || !delays.ok) return <p>{t("Budget.forbidden")}</p>;
  const own = delays.value; // §9 "Budget cash need": a budget saved without delays is shown with the farm's own
  const timingOf = new Map(bases.value.map((b) => [b.batchId, b.timing]));
  const batchLabel = (b: { houseName: string; placedOn: string }) => `${b.houseName} · ${formatDay(b.placedOn as FarmDay, lang)}`; // "B1 · 18 août 2026"
  return (
    <>
      <BudgetPlanner
        bases={bases.value.map((b) => ({ batchId: b.batchId, label: batchLabel(b), inputs: asText(b.inputs), timing: timingText(b.timing) }))}
        batches={batches.value.map((b) => ({ batchId: b.batchId, label: batchLabel(b) }))}
        delays={own}
        save={can(ctx.value, "finance.record") ? saveBudgetAction : undefined}
      />
      {/* tasks/plan-ui-cleanup.md §4: one row per saved budget, its weekly cash folded in the row under it */}
      <section aria-labelledby="budget-saved" className="flex flex-col gap-3">
        <h2 id="budget-saved" className={sectionTitle}>{t("Budget.saved")}</h2>
        {saved.value.length === 0 ? (
          <p className={empty}>{t("Budget.none")}</p>
        ) : (
          <div className={dataTableWrap}>
            <table className={dataTable} aria-labelledby="budget-saved">
              <thead>
                <tr>
                  <th scope="col">{t("Budget.name")}</th>
                  {/* not `num`: its nowrap would push the phone's three columns past the screen */}
                  <th scope="col" className="text-end!">{t("Budget.breakEven")}</th>
                  <th scope="col" className="text-end!">{t("Budget.plannedMargin")}</th>
                </tr>
              </thead>
              {saved.value.map((s) => {
                const b = budgetOf(s.inputs);
                // §9 "Budget cash need": its base batch's timing, or the plain rule from its saved sale day
                const timing = s.basedOn ? timingOf.get(s.basedOn) : s.saleDay === null ? undefined : plainTiming(s.saleDay);
                const cash = timing && budgetCash(s.inputs, timing, { chicks: s.delays.chicks ?? own.chicks, feed: s.delays.feed ?? own.feed });
                return (
                  <tbody key={s.id}>
                    <tr>
                      <th scope="row" className="font-semibold!">{s.name}</th>
                      <Num className="whitespace-nowrap">{b.breakEvenPerKgCentimes === null ? "—" : `${formatMoney(b.breakEvenPerKgCentimes)} / kg`}</Num>
                      <Num className="font-semibold">{formatMoney(b.plannedMarginCentimes)}</Num>
                    </tr>
                    {cash && (
                      <tr className="border-t-0!">
                        <td colSpan={3} className="pt-0!">
                          <details className="flex flex-col gap-2">
                            <summary className="disclosure text-ink-2">{t("Budget.cash")}</summary>
                            <BudgetCashView cash={cash} label={`${t("Budget.cash")} · ${s.name}`} fromBase={s.basedOn !== null} />
                          </details>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </section>
    </>
  );
}
