import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Fragment, Suspense } from "react";
import { Link, redirect } from "@/i18n/navigation";
import { formatCount, formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { batchOf, readBooks, type IncomeStatement } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { BackLink } from "@/components/app-nav";
import { card, table } from "@/components/ui";
import { ManualEntryForm, PeriodLockForm, ReverseEntryForm } from "./form";

// SPEC-finance FN16: the books the entity's profile keeps, for a month. Online, owner and manager; read from the ledger.
// FCX3: the owner's manual entry form; a cash_book entity's carries its opening bank and cash balances (FN3, FQ11).
// FCX6: the CPC and the bilan are a "Projet" until the year is closed, then "Exercice clôturé le …".
// FN5: the month's lock, the owner locks or unlocks it (a closed year's months: its reopen, on /closing); the owner
// cancels a manual entry from the journal.
// FC7: the month's home consumptions that post nothing (FQ25, no value) are listed, whatever the view.
// FC9: /treasury/bank opens the manual entry prefilled with a statement line not in the books (?day&label&debit&bank).
type Search = Promise<{ [key: string]: string | string[] | undefined }>;
const VIEWS = ["cash", "journals", "ledger", "trial", "cpc", "bilan"] as const;

export default function BooksPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
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
  const today = farmDayOf(new Date());
  const month = typeof search.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month) ? search.month : today.slice(0, 7);
  const result = await readBooks(ctx.value, month);
  if (!result.ok) return <p>{t("Expenses.forbidden")}</p>;
  const books = result.value;
  const bilan = books.balanceSheet;
  const views = books.books === "ledger" ? VIEWS : (["cash"] as const);
  const view = views.find((v) => v === search.view) ?? views[0];
  const money = (c: bigint) => (c === 0n ? "" : formatMoney(c));
  const day = (d: string) => formatDay(d as FarmDay, lang);
  const closed = books.closedOn ? day(books.closedOn) : null;
  const account = (n: string) => `${n} ${books.labels[n] ?? ""}`;
  const href = (v: string, m: string) => ({ pathname: "/books", query: { view: v, month: m } });
  const manage = can(ctx.value, "finance.manage");
  const locked = books.lockedMonths.includes(month);
  const one = (k: string, v = search[k]) => (typeof v === "string" ? v : "");
  const prefill = /^\d{4}-\d{2}-\d{2}$/.test(one("day")) && one("bank") ? { day: one("day"), label: one("label"), debit: one("debit"), bank: one("bank") } : undefined;
  const lockedInYear = books.lockedMonths.filter((m) => m >= books.fiscalYear.from.slice(0, 7) && m <= books.fiscalYear.to.slice(0, 7));

  return (
    <>
      <h1 className="text-2xl font-semibold">{t(books.books === "ledger" ? "Books.titleLedger" : "Books.titleCashBook")}</h1>
      <nav className="flex flex-wrap items-center gap-3" aria-label={t("Books.month")}>
        <Link href={href(view, shift(month, -1))} className="underline underline-offset-4">←</Link>
        <span className="font-semibold" dir="ltr">{month}</span>
        <Link href={href(view, shift(month, 1))} className="underline underline-offset-4">→</Link>
        {/* FN18: a file, not a page, so a plain link to the route handler */}
        <a href={`/api/finance/export?month=${month}`} download className="ms-auto underline underline-offset-4">{t("Books.export")}</a>
        {books.books === "ledger" && <a href={`/api/finance/export?month=${month}&format=fec`} download className="underline underline-offset-4">{t("Books.exportFec")}</a>}
      </nav>
      <section className={card} aria-labelledby="period-title">
        <h2 id="period-title" className="font-semibold">{t("Books.period")}</h2>
        <p>{t(locked ? "Books.monthIsLocked" : "Books.monthIsOpen")}</p>
        {lockedInYear.length > 0 && (
          <p className="text-sm text-ink-2">
            {t("Books.lockedMonths")}{" "}
            {lockedInYear.map((m, i) => (
              <Fragment key={m}>
                {i > 0 && ", "}
                <Link href={href(view, m)} className="underline underline-offset-4" dir="ltr">{m}</Link>
              </Fragment>
            ))}
          </p>
        )}
        {manage &&
          (locked && closed ? (
            <p className="text-sm text-ink-2">
              {t("errors.FISCAL_YEAR_CLOSED")}{" "}
              <Link href={{ pathname: "/closing", query: { year: books.fiscalYear.to.slice(0, 4) } }} className="underline underline-offset-4">{t("Close.open")}</Link>
            </p>
          ) : (
            <PeriodLockForm month={month} locked={locked} />
          ))}
      </section>
      {manage && (
        <details open={!!prefill} className={card}>
          <summary className="cursor-pointer font-semibold">{t("Books.manual")}</summary>
          <p className="text-sm text-ink-2">{t(books.books === "ledger" ? "Books.manualOpening" : "Books.manualCashBook", { from: day(books.fiscalYear.from) })}</p>
          <datalist id="ledger-accounts">
            {books.postingAccounts?.map((a) => <option key={a.number} value={a.number}>{`${a.number} ${a.label}`}</option>)}
          </datalist>
          <ManualEntryForm today={today} accounts="ledger-accounts" treasuries={books.treasuryAccounts ?? []} prefill={prefill} />
        </details>
      )}
      {books.unposted.length > 0 && (
        <section className={card} aria-labelledby="unposted-title">
          <h2 id="unposted-title" className="font-semibold">{t("Books.unposted")}</h2>
          <ul className="flex flex-col gap-1">
            {books.unposted.map((u) => (
              <li key={u.id}>
                {t("Books.unpostedLine", {
                  date: day(u.day),
                  who: t(`Sale.takers.${u.takenBy}`),
                  quantity: t(u.kind === "eggs" ? "Books.unpostedEggs" : "Books.unpostedBirds", { n: formatCount(u.kind === "eggs" ? u.eggs : u.birds) }),
                  amount: formatMoney(u.amountCentimes),
                  reason: t(`Books.unpostedReason.${u.reason}`),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
      {views.length > 1 && (
        <nav className="flex flex-wrap gap-3" aria-label={t("Books.views")}>
          {views.map((v) => (
            <Link key={v} href={href(v, month)} aria-current={v === view ? "page" : undefined} className={v === view ? "font-semibold" : "underline underline-offset-4"}>
              {t(v === "bilan" && closed ? "Books.bilanClosed" : `Books.${v}`)}
            </Link>
          ))}
        </nav>
      )}

      {view === "cash" && (
        <div className="overflow-x-auto">
          <table className={table} aria-label={t("Books.cash")}>
            <thead>
              <tr>
                <th className="p-2 text-start">{t("Books.day")}</th>
                <th className="p-2 text-start">{t("Books.label")}</th>
                <th className="p-2 text-start">{t("Books.account")}</th>
                <th className="p-2 text-start">{t("Books.batch")}</th>
                <th className="p-2 text-end">{t("Books.receipt")}</th>
                <th className="p-2 text-end">{t("Books.expense")}</th>
              </tr>
            </thead>
            <tbody>
              {books.cashBook.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="p-2">{day(r.day)}</td>
                  <td className="p-2">{r.label}{r.counterAccounts.length > 0 && <span className="text-muted"> · {r.counterAccounts.map((a) => books.labels[a] ?? a).join(", ")}</span>}</td>
                  <td className="p-2"><bdi dir="ltr">{account(r.account)}</bdi></td>
                  <td className="p-2">{batchOf(books.tags, r.entryId)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.receipt)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.expense)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-semibold">
                <td className="p-2" colSpan={4}>{t("Books.total")}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(books.cashBook.receipts)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(books.cashBook.expenses)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {view === "journals" &&
        books.journals?.map((j) => (
          <section key={j.journal} className="flex flex-col gap-2">
            <h2 className="text-[17px] font-semibold text-ink-2">{t("Books.journal", { journal: j.journal })}</h2>
            {j.entries.map((e) => (
              <Fragment key={e.id}>
                <table className={table}>
                  <caption className="text-start font-semibold">
                    {day(e.day)} · {e.label}
                    {e.piece && <> · {t("Books.pieceOf", { piece: e.piece })}</>}
                    {e.receipt && <> · <a href={`/api/files/${e.receipt}`} className="underline underline-offset-4">{t("Books.receiptOf")}</a></>}
                    {e.reversed && <> · {t("Books.reversedTag")}</>}
                  </caption>
                  <tbody>
                    {e.lines.map((l, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="p-2"><bdi dir="ltr">{account(l.account)}</bdi></td>
                        <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.debit)}</td>
                        <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {manage && e.reversed !== undefined && <ReverseEntryForm entryId={e.id} name={`${day(e.day)} · ${e.label}`} reversed={e.reversed} />}
              </Fragment>
            ))}
          </section>
        ))}

      {view === "ledger" &&
        books.generalLedger?.map((a) => (
          <div key={a.account} className="overflow-x-auto">
            <table className={table}>
              <caption className="text-start font-semibold"><bdi dir="ltr">{account(a.account)}</bdi></caption>
              <tbody>
                {a.lines.map((l, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="p-2">{day(l.day)}</td>
                    <td className="p-2">{l.journal} · {l.label}</td>
                    <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.debit)}</td>
                    <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.credit)}</td>
                    <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(l.running)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {view === "trial" && books.trialBalance && (
        <div className="overflow-x-auto">
          <table className={table} aria-label={t("Books.trial")}>
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
                <tr key={r.account} className="border-t border-line">
                  <td className="p-2"><bdi dir="ltr">{account(r.account)}</bdi></td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.debit)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{money(r.credit)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(r.balance)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-semibold">
                <td className="p-2">{t(books.trialBalance.balanced ? "Books.balanced" : "Books.unbalanced")}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(books.trialBalance.debit)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(books.trialBalance.credit)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {view === "cpc" && books.incomeStatement && (
        <table className={table} aria-label={t("Books.cpc")}>
          <caption className="text-start">{closed ? t("Books.cpcClosed", { closed, from: day(books.fiscalYear.from) }) : t("Books.cpcDraft", { from: day(books.fiscalYear.from) })}</caption>
          <tbody>
            {cpcRows(books.incomeStatement).map((r) => (
              <tr key={r.key} className={`border-t border-line ${r.kind === "line" ? "" : "font-semibold"} ${r.kind === "head" ? "bg-shell" : ""} ${r.kind === "total" ? "border-t-2" : ""}`}>
                <td className={`p-2 ${r.kind === "line" ? "ps-6" : ""}`}>{r.kind === "line" ? <bdi dir="ltr">{account(r.label)}</bdi> : t(r.label)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {view === "bilan" && bilan && (
        <table className={table} aria-label={t(closed ? "Books.bilanClosed" : "Books.bilan")}>
          <caption className="text-start">{closed ? t("Books.bilanClosedCaption", { closed, from: day(books.fiscalYear.from) }) : t("Books.bilanDraft", { from: day(books.fiscalYear.from) })}</caption>
          <tbody>
            {([["assets", bilan.totalAssets], ["liabilities", bilan.totalLiabilities]] as const).map(([side, total]) => (
              <Fragment key={side}>
                <tr className="border-t-2 border-line bg-shell font-semibold">
                  <td className="p-2">{t(`Books.bilanSides.${side}`)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(total)}</td>
                </tr>
                {bilan[side].map((l) => (
                  <tr key={l.account} className="border-t border-line">
                    <td className="p-2 ps-6"><bdi dir="ltr">{account(l.account)}</bdi></td>
                    <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(l.amount)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="border-t border-line">
              <td className="p-2 ps-6">{t("Books.cpcNet")}</td>
              <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(bilan.result)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}

type CpcRow = { key: string; kind: "head" | "line" | "result" | "total"; label: string; amount: bigint };

/** F-Statements: the CPC's rows in reading order (a message key, or an account for a line). */
function cpcRows(cpc: IncomeStatement): CpcRow[] {
  const rows: CpcRow[] = [];
  const block = (key: string, label: string, lines: readonly { account: string; amount: bigint }[]) => {
    rows.push({ key, kind: "head", label, amount: lines.reduce((a, l) => a + l.amount, 0n) });
    for (const l of lines) rows.push({ key: `${key}-${l.account}`, kind: "line", label: l.account, amount: l.amount });
  };
  for (const s of cpc.sections) {
    if (s.key !== "tax") block(`${s.key}-income`, `Books.cpcSections.${s.key}.income`, s.income);
    block(`${s.key}-charges`, `Books.cpcSections.${s.key}.charges`, s.charges);
    if (s.key !== "tax") rows.push({ key: `${s.key}-result`, kind: "result", label: `Books.cpcSections.${s.key}.result`, amount: s.result });
    if (s.key === "financial") rows.push({ key: "current", kind: "total", label: "Books.cpcCurrent", amount: cpc.current });
    if (s.key === "nonCurrent") rows.push({ key: "beforeTax", kind: "total", label: "Books.cpcBeforeTax", amount: cpc.beforeTax });
  }
  rows.push({ key: "net", kind: "total", label: "Books.cpcNet", amount: cpc.net });
  return rows;
}
