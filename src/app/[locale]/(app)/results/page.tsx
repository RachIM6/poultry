import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { batchResults } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

// SPEC-finance FN13: each batch's result side by side, newest first, so the owner compares it with the last batches.
// Online, owner and manager; computed from the server's records, never cached.
export default function ResultsPage() {
  return (
    <>
      <header className="flex justify-between gap-4 p-4">
        <Link href="/dashboard" className="py-2 underline underline-offset-4">←</Link>
        <LocaleSwitcher />
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
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Results.title")}</h1>
      {results.value.length === 0 ? (
        <p>{t("Results.none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
                <tr key={r.id} className="border-t border-current/20 align-top">
                  <td className="p-2">
                    <div className="font-semibold">{r.houseName} · {formatDay(r.placedOn as FarmDay, lang)}</div>
                    <div className="opacity-75">{r.closedOn ? t("Results.closed", { date: formatDay(r.closedOn as FarmDay, lang) }) : t("Results.open_")}</div>
                    <div className="opacity-75">
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
