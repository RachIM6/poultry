import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BackLink } from "@/components/app-nav";
import { card, table, warn } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { can } from "@/lib/permissions";
import { closePreview } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { CloseForm } from "./form";

// SPEC-finance FCX4 (T103), FCX2: "Préparer la clôture", online like /books. Each kind's year-end entry, OD on the
// fiscal year's last day, as the run would post it; the owner posts it, the manager and the accountant read it.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default function ClosingPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <CloseView searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function CloseView({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const result = await closePreview(ctx.value, typeof search.year === "string" && /^\d{4}$/.test(search.year) ? Number(search.year) : null);
  if (!result.ok) return <p>{t("Expenses.forbidden")}</p>;
  const { year, day, books, locked, entries } = result.value;
  const todo = entries.some((e) => e.action === "post" || e.action === "repost" || e.action === "reverse");
  const money = (c: bigint) => (c === 0n ? "" : formatMoney(c));

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Close.title")}</h1>
      <nav className="flex flex-wrap items-center gap-3" aria-label={t("Count.year")}>
        <Link href={{ pathname: "/closing", query: { year: year - 1 } }} className="inline-block underline underline-offset-4 rtl:-scale-x-100">←</Link>
        <span className="font-semibold" dir="ltr">{year}</span>
        <Link href={{ pathname: "/closing", query: { year: year + 1 } }} className="inline-block underline underline-offset-4 rtl:-scale-x-100">→</Link>
        <Link href={{ pathname: "/closing/count", query: { year } }} className="ms-auto underline underline-offset-4">{t("Count.open")}</Link>
      </nav>
      <p className="text-sm text-ink-2">{t("Close.hint", { day: formatDay(day, lang) })}</p>
      {books !== "ledger" && <p className={warn}>{t("Close.cashBook")}</p>}
      {locked && <p className={warn}>{t("Close.locked")}</p>}
      {entries.map((e) => (
        <section key={e.kind} aria-label={t(`Close.kinds.${e.kind}`)} className={card}>
          <h2 className="text-xl font-semibold">{t(`Close.kinds.${e.kind}`)}</h2>
          <p>{t(`Close.actions.${e.action}`)}</p>
          {e.lines.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className={table} aria-label={t("Close.entryOf", { kind: t(`Close.kinds.${e.kind}`) })}>
                <thead>
                  <tr>
                    <th className="p-2 text-start">{t("Books.account")}</th>
                    <th className="p-2 text-end">{t("Books.debit")}</th>
                    <th className="p-2 text-end">{t("Books.credit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="p-2"><bdi dir="ltr">{l.account}</bdi> {l.label}</td>
                      <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.debit)}</td>
                      <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      {books === "ledger" && !todo && <p>{t("Close.nothing")}</p>}
      {books === "ledger" && can(ctx.value, "finance.manage") && <CloseForm year={year} disabled={locked} />}
    </>
  );
}
