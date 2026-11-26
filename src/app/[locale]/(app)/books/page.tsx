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
import { card, ghost } from "@/components/ui";
import { dataTable, dataTableWrap } from "@/components/layout";
import { Num, Scroll } from "@/components/num";
import { Page, PeriodNav } from "@/components/page";
import { pageOf } from "@/components/paging";
import { Pager } from "@/components/pager";
import { Tabs } from "@/components/tabs";
import { ManualEntryForm, ManualEntrySheet, PeriodLockForm, ReverseEntryForm } from "./form";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Books", "Files", "Nav", "Offline", "Sync.refused", "Ui", "errors"];

// SPEC-finance FN16: the books the entity's profile keeps, for a month. Online, owner and manager; read from the ledger.
// FCX3: the owner's manual entry form; a cash_book entity's carries its opening bank and cash balances (FN3, FQ11).
// FCX6: the CPC and the bilan are a "Projet" until the year is closed, then "Exercice clôturé le …".
// FN5: the month's lock, the owner locks or unlocks it (a closed year's months: its reopen, on /closing); the owner
// cancels a manual entry from the journal.
// FC7: the month's home consumptions that post nothing (FQ25, no value) are listed, whatever the view.
// FC9: /treasury/bank opens the manual entry prefilled with a statement line not in the books (?day&label&debit&bank).
type Search = Promise<{ [key: string]: string | string[] | undefined }>;
const VIEWS = ["cash", "journals", "ledger", "trial", "cpc", "bilan"] as const;
/** Lines per page of the cash book, the journals and the ledger (tasks/plan-ui-cleanup.md §4 /books). */
const PAGE = 50;

/** The page asked for, of `rows` grouped by `key` (a journal, an account): its groups, each with its rows on that page. */
function paged<T>(rows: readonly T[], value: unknown) {
  const page = pageOf(value, rows.length, PAGE);
  return { page, total: rows.length, rows: rows.slice((page - 1) * PAGE, page * PAGE) };
}
const grouped = <T, K>(rows: readonly { key: K; row: T }[]) =>
  rows.reduce<{ key: K; rows: T[] }[]>((groups, { key, row }) => {
    if (groups.at(-1)?.key === key) groups.at(-1)!.rows.push(row);
    else groups.push({ key, rows: [row] });
    return groups;
  }, []);

// The title says which books the entity keeps (data): the whole Page streams in, its fallback keeps the back link.
export default function BooksPage({ searchParams }: { searchParams: Search }) {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/more" />}>
        <BooksView searchParams={searchParams} />
      </Suspense>
    </ClientMessages>
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
  if (!result.ok) {
    return (
      <Page width="wide" back="/more">
        <p>{t("Books.forbidden")}</p>
      </Page>
    );
  }
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
  // "novembre 2026", not "2026-11" (as the register's months; not in lib/format, which /batches ships)
  const monthName = (m: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));

  // shortcut: in-memory page slice, move to skip/take in the module read when a month passes ~1 000 lines.
  const cash = paged(books.cashBook.rows, search.page);
  const journals = paged(books.journals?.flatMap((j) => j.entries.map((e) => ({ key: j.journal, row: e }))) ?? [], search.page);
  const ledger = paged(books.generalLedger?.flatMap((a) => a.lines.map((l) => ({ key: a.account, row: l }))) ?? [], search.page);
  const pager = (p: { page: number; total: number }) => <Pager page={p.page} size={PAGE} total={p.total} href={(n) => ({ pathname: "/books", query: { view, month, page: n } })} />;

  return (
    <Page
      width="wide"
      back="/more"
      title={t(books.books === "ledger" ? "Books.titleLedger" : "Books.titleCashBook")}
      actions={
        manage && (
          // FC9: opened at once when /treasury/bank sends a statement line to book.
          <ManualEntrySheet label={t("Books.manual")} open={!!prefill}>
            <p className="max-w-prose text-sm text-ink-2">{t(books.books === "ledger" ? "Books.manualOpening" : "Books.manualCashBook", { from: day(books.fiscalYear.from) })}</p>
            <datalist id="ledger-accounts">
              {books.postingAccounts?.map((a) => <option key={a.number} value={a.number}>{`${a.number} ${a.label}`}</option>)}
            </datalist>
            <ManualEntryForm today={today} accounts="ledger-accounts" treasuries={books.treasuryAccounts ?? []} prefill={prefill} />
          </ManualEntrySheet>
        )
      }
      nav={
        <>
          <PeriodNav
            label={t("Books.month")}
            period={monthName(month)}
            prev={{ href: href(view, shift(month, -1)), label: t("Books.previousMonth") }}
            next={{ href: href(view, shift(month, 1)), label: t("Books.nextMonth") }}
            end={
              <>
                {/* FN18: a file, not a page, so a plain link to the route handler */}
                <a href={`/api/finance/export?month=${month}`} download className={ghost}>{t("Books.export")}</a>
                {books.books === "ledger" && <a href={`/api/finance/export?month=${month}&format=fec`} download className={ghost}>{t("Books.exportFec")}</a>}
              </>
            }
          />
          {views.length > 1 && (
            <Tabs
              label={t("Books.views")}
              current={view}
              tabs={views.map((v) => ({ key: v, label: t(v === "bilan" && closed ? "Books.bilanClosed" : `Books.${v}`), href: href(v, month) }))}
            />
          )}
        </>
      }
    >
      <section className={`${card} lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-4`} aria-labelledby="period-title">
        <h2 id="period-title" className="font-semibold">{t("Books.period")}</h2>
        <p className="text-sm">{t(locked ? "Books.monthIsLocked" : "Books.monthIsOpen")}</p>
        {lockedInYear.length > 0 && (
          <p className="text-sm text-ink-2">
            {t("Books.lockedMonths")}{" "}
            {lockedInYear.map((m, i) => (
              <Fragment key={m}>
                {i > 0 && ", "}
                <Link href={href(view, m)} className="underline underline-offset-4">{monthName(m)}</Link>
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
            <div className="lg:ms-auto">
              <PeriodLockForm month={month} locked={locked} />
            </div>
          ))}
      </section>
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
      {books.unpostedDeliveries.length > 0 && (
        <section className={card} aria-labelledby="unposted-deliveries-title">
          <h2 id="unposted-deliveries-title" className="font-semibold">{t("Books.unpostedDeliveries")}</h2>
          <p className="max-w-prose text-sm text-ink-2">{t("Books.unpostedDeliveriesHint")}</p>
          <ul className="flex flex-col gap-1">
            {books.unpostedDeliveries.map((u) => (
              <li key={u.batchId}>{t("Books.unpostedDeliveryLine", { date: day(u.placedOn), hatchery: u.hatchery, amount: formatMoney(u.amountCentimes) })}</li>
            ))}
          </ul>
        </section>
      )}

      {view === "cash" && (
        <Scroll label={t("Books.cash")} className={dataTableWrap}>
          <table className={dataTable} aria-label={t("Books.cash")}>
            <thead>
              <tr>
                <th>{t("Books.day")}</th>
                <th>{t("Books.label")}</th>
                <th>{t("Books.account")}</th>
                <th>{t("Books.batch")}</th>
                <th className="text-end!">{t("Books.receipt")}</th>
                <th className="text-end!">{t("Books.expense")}</th>
              </tr>
            </thead>
            <tbody>
              {cash.rows.map((r, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap p-2">{day(r.day)}</td>
                  <td className="p-2">{r.label}{r.counterAccounts.length > 0 && <span className="text-muted"> · {r.counterAccounts.map((a) => books.labels[a] ?? a).join(", ")}</span>}</td>
                  <td className="whitespace-nowrap"><bdi dir="ltr">{account(r.account)}</bdi></td>
                  <td className="whitespace-nowrap">{batchOf(books.tags, r.entryId)}</td>
                  <Num>{money(r.receipt)}</Num>
                  <Num>{money(r.expense)}</Num>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-semibold">
                <td className="p-2" colSpan={4}>{t("Books.total")}</td>
                <Num>{formatMoney(books.cashBook.receipts)}</Num>
                <Num>{formatMoney(books.cashBook.expenses)}</Num>
              </tr>
            </tbody>
          </table>
        </Scroll>
      )}
      {view === "cash" && pager(cash)}

      {view === "journals" &&
        grouped(journals.rows).map((j) => (
          <section key={j.key} className="flex flex-col gap-2">
            <h2 className="text-[17px] font-semibold text-ink-2">{t("Books.journal", { journal: j.key })}</h2>
            {/* One scroll per journal, not per entry: one tab stop */}
            <Scroll label={t("Books.journal", { journal: j.key })} className={`${dataTableWrap} flex flex-col gap-1 pb-2`}>
              {j.rows.map((e) => (
                <Fragment key={e.id}>
                  <table className={dataTable}>
                    <caption className="px-3 pt-3 pb-1 text-start font-semibold">
                      {day(e.day)} · {e.label}
                      {e.piece && <> · {t("Books.pieceOf", { piece: e.piece })}</>}
                      {e.receipt && <> · <a href={`/api/files/${e.receipt}`} className="underline underline-offset-4">{t("Books.receiptOf")}</a></>}
                      {e.reversed && <> · {t("Books.reversedTag")}</>}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("Books.account")}</th>
                        <th scope="col" className="text-end!">{t("Books.debit")}</th>
                        <th scope="col" className="text-end!">{t("Books.credit")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="p-2"><bdi dir="ltr">{account(l.account)}</bdi></td>
                          <Num>{money(l.debit)}</Num>
                          <Num>{money(l.credit)}</Num>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {manage && e.reversed !== undefined && <div className="px-3"><ReverseEntryForm entryId={e.id} name={`${day(e.day)} · ${e.label}`} reversed={e.reversed} /></div>}
                </Fragment>
              ))}
            </Scroll>
          </section>
        ))}
      {view === "journals" && pager(journals)}

      {view === "ledger" && books.generalLedger && (
        <Scroll label={t("Books.ledger")} className={`${dataTableWrap} flex flex-col gap-4 pb-2`}>
          {grouped(ledger.rows).map((a) => (
            <table key={a.key} className={dataTable}>
              <caption className="px-3 pt-3 pb-1 text-start font-semibold"><bdi dir="ltr">{account(a.key)}</bdi></caption>
              <thead>
                <tr>
                  <th scope="col">{t("Books.day")}</th>
                  <th scope="col">{t("Books.label")}</th>
                  <th scope="col" className="text-end!">{t("Books.debit")}</th>
                  <th scope="col" className="text-end!">{t("Books.credit")}</th>
                  <th scope="col" className="text-end!">{t("Books.balance")}</th>
                </tr>
              </thead>
              <tbody>
                {a.rows.map((l, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap p-2">{day(l.day)}</td>
                    <td className="p-2">{l.journal} · {l.label}</td>
                    <Num>{money(l.debit)}</Num>
                    <Num>{money(l.credit)}</Num>
                    <Num>{formatMoney(l.running)}</Num>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </Scroll>
      )}
      {view === "ledger" && pager(ledger)}

      {view === "trial" && books.trialBalance && (
        <Scroll label={t("Books.trial")} className={dataTableWrap}>
          <table className={dataTable} aria-label={t("Books.trial")}>
            <caption className="px-3 pt-3 pb-1 text-start">{t("Books.since", { from: day(books.fiscalYear.from) })}</caption>
            <thead>
              <tr>
                <th>{t("Books.account")}</th>
                <th className="text-end!">{t("Books.debit")}</th>
                <th className="text-end!">{t("Books.credit")}</th>
                <th className="text-end!">{t("Books.balance")}</th>
              </tr>
            </thead>
            <tbody>
              {books.trialBalance.rows.map((r) => (
                <tr key={r.account}>
                  <td className="p-2"><bdi dir="ltr">{account(r.account)}</bdi></td>
                  <Num>{money(r.debit)}</Num>
                  <Num>{money(r.credit)}</Num>
                  <Num>{formatMoney(r.balance)}</Num>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-semibold">
                <td className="p-2">{t(books.trialBalance.balanced ? "Books.balanced" : "Books.unbalanced")}</td>
                <Num>{formatMoney(books.trialBalance.debit)}</Num>
                <Num>{formatMoney(books.trialBalance.credit)}</Num>
                <td />
              </tr>
            </tbody>
          </table>
        </Scroll>
      )}
      {view === "cpc" && books.incomeStatement && (
        <Scroll label={t("Books.cpc")} className={dataTableWrap}>
          <table className={dataTable} aria-label={t("Books.cpc")}>
            <caption className="px-3 pt-3 pb-1 text-start">{closed ? t("Books.cpcClosed", { closed, from: day(books.fiscalYear.from) }) : t("Books.cpcDraft", { from: day(books.fiscalYear.from) })}</caption>
            <tbody>
              {cpcRows(books.incomeStatement).map((r) => (
                <tr key={r.key} className={`border-t border-line ${r.kind === "line" ? "" : "font-semibold"} ${r.kind === "head" ? "bg-shell" : ""} ${r.kind === "total" ? "border-t-2" : ""}`}>
                  <td className={`p-2 ${r.kind === "line" ? "ps-6" : ""}`}>{r.kind === "line" ? <bdi dir="ltr">{account(r.label)}</bdi> : t(r.label)}</td>
                  <Num>{formatMoney(r.amount)}</Num>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      )}
      {view === "bilan" && bilan && (
        <Scroll label={t(closed ? "Books.bilanClosed" : "Books.bilan")} className={dataTableWrap}>
          <table className={dataTable} aria-label={t(closed ? "Books.bilanClosed" : "Books.bilan")}>
            <caption className="px-3 pt-3 pb-1 text-start">{closed ? t("Books.bilanClosedCaption", { closed, from: day(books.fiscalYear.from) }) : t("Books.bilanDraft", { from: day(books.fiscalYear.from) })}</caption>
            <tbody>
              {([["assets", bilan.totalAssets], ["liabilities", bilan.totalLiabilities]] as const).map(([side, total]) => (
                <Fragment key={side}>
                  <tr className="border-t-2 border-line bg-shell font-semibold">
                    <td className="p-2">{t(`Books.bilanSides.${side}`)}</td>
                    <Num>{formatMoney(total)}</Num>
                  </tr>
                  {bilan[side].map((l) => (
                    <tr key={l.account}>
                      <td className="p-2 ps-6"><bdi dir="ltr">{account(l.account)}</bdi></td>
                      <Num>{formatMoney(l.amount)}</Num>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="border-t border-line">
                <td className="p-2 ps-6">{t("Books.cpcNet")}</td>
                <Num>{formatMoney(bilan.result)}</Num>
              </tr>
            </tbody>
          </table>
        </Scroll>
      )}
    </Page>
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
