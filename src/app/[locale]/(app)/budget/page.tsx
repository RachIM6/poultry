import { headers } from "next/headers";
import { locale } from "next/root-params";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BudgetPlanner } from "@/components/budget";
import { BudgetCashView } from "@/components/budget-cash";
import { redirect } from "@/i18n/navigation";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/permissions";
import { budgetBases, budgetBatches, budgetCash, budgetPaymentDelays, budgetOf, listBudgets, plainTiming, type CashTiming } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { saveBudgetAction } from "./actions";
import { Page } from "@/components/page";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Budget", "Nav", "Offline", "Sync.refused", "errors"];

// SPEC-finance FN15: plan the next batch from a closed one, with what-if feed and sale prices. Online, owner and manager.
export default function BudgetPage() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/more" title={t("Budget.title")}>
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
  return (
    <>
      <BudgetPlanner bases={bases.value.map((b) => ({ batchId: b.batchId, label: b.label, inputs: asText(b.inputs), timing: timingText(b.timing) }))} batches={batches.value} delays={own} save={can(ctx.value, "finance.record") ? saveBudgetAction : undefined} />
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Budget.saved")}</h2>
      {saved.value.length === 0 ? (
        <p>{t("Budget.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("Budget.saved")}>
          {saved.value.map((s) => {
            const b = budgetOf(s.inputs);
            // §9 "Budget cash need": its base batch's timing, or the plain rule from its saved sale day
            const timing = s.basedOn ? timingOf.get(s.basedOn) : s.saleDay === null ? undefined : plainTiming(s.saleDay);
            const cash = timing && budgetCash(s.inputs, timing, { chicks: s.delays.chicks ?? own.chicks, feed: s.delays.feed ?? own.feed });
            return (
              <li key={s.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-3">
                <p>
                  <span className="font-semibold">{s.name}</span> ·{" "}
                  {t("Budget.line", {
                    breakEven: b.breakEvenPerKgCentimes === null ? "—" : formatMoney(b.breakEvenPerKgCentimes),
                    margin: formatMoney(b.plannedMarginCentimes),
                  })}
                </p>
                {cash && (
                  <details className="flex flex-col gap-2">
                    <summary className="disclosure text-ink-2">{t("Budget.cash")}</summary>
                    <BudgetCashView cash={cash} label={`${t("Budget.cash")} · ${s.name}`} fromBase={s.basedOn !== null} />
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
