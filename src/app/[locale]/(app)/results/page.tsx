import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ClientMessages } from "@/i18n/client-messages";
import { redirect } from "@/i18n/navigation";
import type { MessagePath } from "@/i18n/pick";
import { formatDay, formatDecimal, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { typedCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import { batchResults } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { BackLink } from "@/components/app-nav";
import { table } from "@/components/ui";
import { Num } from "@/components/num";
import { ScheduleForm } from "./form";

// SPEC-finance FN13: each batch's result side by side, newest first, so the owner compares it with the last batches.
// Online, owner and manager; computed from the server's records, never cached. An open laying flock's laying period and
// cull value are typed here, any books (§9 "Laying hens in the batch result"): the owner's under the classic method.
// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Results.schedule", "Nav", "Offline", "Sync.refused", "errors"];

export default function ResultsPage() {
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Results />
        </Suspense>
      </main>
    </ClientMessages>
  );
}

const permille = (p: bigint) => `${p < 0n ? "-" : ""}${(p < 0n ? -p : p) / 10n},${(p < 0n ? -p : p) % 10n} %`;

async function Results() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const results = await batchResults(ctx.value);
  if (!results.ok) return <p>{t("Results.forbidden")}</p>;
  const money = (c: bigint | null) => (c === null ? "—" : formatMoney(c));
  // FN13: the comparison with the farm's last batches, under each batch
  const kpis = (c: (typeof results.value)[number]["comparison"]) =>
    t("Results.kpis", {
      lost: c.lostPermille === null ? "—" : permille(c.lostPermille),
      fcr: c.fcr === null ? "—" : formatDecimal(c.fcr, 2), // as the batch screen, its report and /compare
      feed: money(c.feedPricePerKgCentimes),
      price: money(c.pricePerKgCentimes),
    });
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Results.title")}</h1>
      {results.value.length === 0 ? (
        <p>{t("Results.none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={table}>
            <thead>
              <tr>
                <th className="p-2 text-start">{t("Results.batch")}</th>
                <th className="p-2 text-end">{t("Results.sales")}</th>
                <th className="p-2 text-end">{t("Results.cost")}</th>
                <th className="p-2 text-end">{t("Results.margin")}</th>
                <th className="p-2 text-end">{t("Results.marginPerKg")}</th>
                <th className="p-2 text-end">{t("Results.costPerKg")}</th>
                <th className="p-2 text-end">{t("Results.share")}</th>
              </tr>
            </thead>
            <tbody>
              {results.value.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="p-2">
                    <div className="font-semibold">{r.houseName} · {formatDay(r.placedOn as FarmDay, lang)}</div>
                    <div className="text-muted">{r.closedOn ? t("Results.closed", { date: formatDay(r.closedOn as FarmDay, lang) }) : t("Results.open_")}</div>
                    <div>{kpis(r.comparison)}</div>
                    {r.byBirdDays && <div className="text-muted">{t("Results.byBirdDays")}</div>}
                    <div className="text-muted">
                      {t(r.hens ? "Results.costsHens" : "Results.costs", { chicks: money(r.costs.chicks), hens: money(r.costs.hens), consumption: money(r.costs.consumption), other: money(r.costs.other), direct: money(r.costs.direct), allocated: money(r.costs.allocated) })}
                    </div>
                    {/* §9 "Laying hens in the batch result": the hens are a fixed asset, their price used up over time */}
                    {r.hens && (
                      <div className="text-muted">
                        {r.hens.basis === "depreciation"
                          ? t("Results.hensDepreciation", { entry: money(r.hens.entry), depreciation: money(r.hens.depreciation), removed: money(r.hens.removed) })
                          : t(r.hens.basis === "pending" ? "Results.hensPending" : "Results.hensBirdsGone", { entry: money(r.hens.entry), removed: money(r.hens.removed) })}
                      </div>
                    )}
                    {r.hens && !r.closedOn && can(ctx.value, r.hens.classic ? "finance.manage" : "finance.record") && (
                      <ScheduleForm
                        batchId={r.id}
                        flock={`${r.houseName} · ${formatDay(r.placedOn as FarmDay, lang)}`}
                        life={r.hens.schedule ? String(r.hens.schedule.lifeMonths) : ""}
                        cull={r.hens.schedule ? typedCentimes(r.hens.schedule.cullValue) : ""}
                      />
                    )}
                    {r.costs.transferred !== 0n && <div className="text-muted">{t("Results.transferred", { amount: money(-r.costs.transferred) })}</div>}
                  </td>
                  <Num>{money(r.salesCentimes)}</Num>
                  <Num>{money(r.costCentimes)}</Num>
                  <Num className="font-semibold">{money(r.marginCentimes)}</Num>
                  <Num>{money(r.marginPerKgCentimes)}</Num>
                  <Num>{money(r.costPerKgCentimes)}</Num>
                  <Num>{r.marginPermille === null ? "—" : permille(r.marginPermille)}</Num>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
