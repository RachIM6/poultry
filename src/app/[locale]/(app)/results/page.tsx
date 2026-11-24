import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { batchResults } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { BackLink } from "@/components/app-nav";
import { table } from "@/components/ui";

// SPEC-finance FN13: each batch's result side by side, newest first, so the owner compares it with the last batches.
// Online, owner and manager; computed from the server's records, never cached.
export default function ResultsPage() {
  return (
    <>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Results />
        </Suspense>
      </main>
    </>
  );
}

const permille = (p: bigint) => `${p < 0n ? "-" : ""}${(p < 0n ? -p : p) / 10n},${(p < 0n ? -p : p) % 10n} %`;

async function Results() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const results = await batchResults(ctx.value);
  if (!results.ok) return <p>{t("Expenses.forbidden")}</p>;
  const money = (c: bigint | null) => (c === null ? "—" : formatMoney(c));
  // FN13: the comparison with the farm's last batches, under each batch
  const kpis = (c: (typeof results.value)[number]["comparison"]) =>
    t("Results.kpis", {
      lost: c.lostPermille === null ? "—" : permille(c.lostPermille),
      fcr: c.fcrMilli === null ? "—" : `${c.fcrMilli / 1000n},${String(c.fcrMilli % 1000n).padStart(3, "0").slice(0, 2)}`,
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
                      {t("Results.costs", { chicks: money(r.costs.chicks), consumption: money(r.costs.consumption), other: money(r.costs.other), direct: money(r.costs.direct), allocated: money(r.costs.allocated) })}
                    </div>
                  </td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.salesCentimes)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.costCentimes)}</td>
                  <td dir="ltr" className="p-2 text-end font-semibold tabular-nums">{money(r.marginCentimes)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.marginPerKgCentimes)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.costPerKgCentimes)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{r.marginPermille === null ? "—" : permille(r.marginPermille)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
