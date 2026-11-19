import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { readBooks } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

// SPEC-finance FN16: the books the entity's profile keeps, for a month. Online, owner and manager; read from the ledger.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;
const VIEWS = ["cash", "journals", "ledger", "trial"] as const;

export default function BooksPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <header className="flex justify-between gap-4 p-4">
        <Link href="/dashboard" className="py-2 underline underline-offset-4">←</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <BooksView searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

async function BooksView({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const month = typeof search.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month) ? search.month : farmDayOf(new Date()).slice(0, 7);
  const result = await readBooks(ctx.value, month);
  if (!result.ok) return <p>{t("Expenses.forbidden")}</p>;
  const books = result.value;
  const views = books.books === "ledger" ? VIEWS : (["cash"] as const);
  const view = views.find((v) => v === search.view) ?? views[0];
  const money = (c: bigint) => (c === 0n ? "" : formatMoney(c));
  const day = (d: string) => formatDay(d as FarmDay, lang);
  const account = (n: string) => `${n} ${books.labels[n] ?? ""}`;
  const href = (v: string, m: string) => ({ pathname: "/books", query: { view: v, month: m } });

  return (
    <>
      <h1 className="text-2xl font-semibold">{t(books.books === "ledger" ? "Books.titleLedger" : "Books.titleCashBook")}</h1>
      <nav className="flex flex-wrap items-center gap-3" aria-label={t("Books.month")}>
        <Link href={href(view, shift(month, -1))} className="underline underline-offset-4">←</Link>
        <span className="font-semibold" dir="ltr">{month}</span>
        <Link href={href(view, shift(month, 1))} className="underline underline-offset-4">→</Link>
      </nav>
      {views.length > 1 && (
        <nav className="flex flex-wrap gap-3" aria-label={t("Books.views")}>
          {views.map((v) => (
            <Link key={v} href={href(v, month)} aria-current={v === view ? "page" : undefined} className={v === view ? "font-semibold" : "underline underline-offset-4"}>
              {t(`Books.${v}`)}
            </Link>
          ))}
        </nav>
      )}

      {view === "cash" && (
        <table className="w-full text-sm" aria-label={t("Books.cash")}>
          <thead>
            <tr>
              <th className="p-2 text-start">{t("Books.day")}</th>
              <th className="p-2 text-start">{t("Books.label")}</th>
              <th className="p-2 text-start">{t("Books.account")}</th>
              <th className="p-2 text-end">{t("Books.receipt")}</th>
              <th className="p-2 text-end">{t("Books.expense")}</th>
            </tr>
          </thead>
          <tbody>
            {books.cashBook.rows.map((r, i) => (
              <tr key={i} className="border-t border-current/20">
                <td className="p-2">{day(r.day)}</td>
                <td className="p-2">{r.label}{r.counterAccounts.length > 0 && <span className="opacity-75"> · {r.counterAccounts.map((a) => books.labels[a] ?? a).join(", ")}</span>}</td>
                <td className="p-2">{account(r.account)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.receipt)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.expense)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-current/40 font-semibold">
              <td className="p-2" colSpan={3}>{t("Books.total")}</td>
              <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(books.cashBook.receipts)}</td>
              <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(books.cashBook.expenses)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {view === "journals" &&
        books.journals?.map((j) => (
          <section key={j.journal} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{t("Books.journal", { journal: j.journal })}</h2>
            {j.entries.map((e) => (
              <table key={e.id} className="w-full text-sm">
                <caption className="text-start font-semibold">{day(e.day)} · {e.label}</caption>
                <tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i} className="border-t border-current/20">
                      <td className="p-2">{account(l.account)}</td>
                      <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.debit)}</td>
                      <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </section>
        ))}

      {view === "ledger" &&
        books.generalLedger?.map((a) => (
          <table key={a.account} className="w-full text-sm">
            <caption className="text-start font-semibold">{account(a.account)}</caption>
            <tbody>
              {a.lines.map((l, i) => (
                <tr key={i} className="border-t border-current/20">
                  <td className="p-2">{day(l.day)}</td>
                  <td className="p-2">{l.journal} · {l.label}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.debit)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.credit)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(l.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {view === "trial" && books.trialBalance && (
        <table className="w-full text-sm" aria-label={t("Books.trial")}>
          <caption className="text-start">{t("Books.since", { from: day(books.fiscalYear.from) })}</caption>
          <thead>
            <tr>
              <th className="p-2 text-start">{t("Books.account")}</th>
              <th className="p-2 text-end">{t("Books.debit")}</th>
              <th className="p-2 text-end">{t("Books.credit")}</th>
              <th className="p-2 text-end">{t("Books.balance")}</th>
            </tr>
          </thead>
          <tbody>
            {books.trialBalance.rows.map((r) => (
              <tr key={r.account} className="border-t border-current/20">
                <td className="p-2">{account(r.account)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.debit)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.credit)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(r.balance)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-current/40 font-semibold">
              <td className="p-2">{t(books.trialBalance.balanced ? "Books.balanced" : "Books.unbalanced")}</td>
              <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(books.trialBalance.debit)}</td>
              <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(books.trialBalance.credit)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}
