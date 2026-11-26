import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { card, done, warn } from "@/components/ui";
import { empty, sectionTitle } from "@/components/layout";
import { Page } from "@/components/page";
import { Pager } from "@/components/pager";
import { pageOf, pickTab, TABLE_PAGE } from "@/components/paging";
import { SheetButton } from "@/components/sheet";
import { Tabs } from "@/components/tabs";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { typedCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import { bankReconciliation, IMPORT_MAX_BYTES } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { ImportedTable, ImportForm, MatchTable, StatementForm } from "./forms";
import { TreasuryTabs } from "../treasury-tabs";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Bank", "Nav", "Offline", "Sync.refused", "Treasury.label", "Ui", "errors"];

// SPEC-finance FC9, FCX1, FCX2: bank reconciliation by manual matching. Online, server-rendered from the ledger.
// Owner and manager tick; the accountant reads; workers are refused by finance.
// tasks/plan-ui-cleanup.md: the « Rapprochement » tab of Trésorerie. The statement's figures on top, then its lines,
// « À pointer » by default (?tab=all: all of them), paged (?page= the book lines, ?ipage= the imported ones); adding and
// importing a statement open in sheets.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default function BankPage({ searchParams }: { searchParams: Search }) {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/more" />}>
        <Bank searchParams={searchParams} />
      </Suspense>
    </ClientMessages>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
/** Centimes as the forms take them: 45.00, without its sign. */
const typed = (c: bigint) => typedCentimes(c < 0n ? -c : c, ".");

async function Bank({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const result = await bankReconciliation(ctx.value, one(search.account), one(search.statement));
  const shell = { width: "wide", back: "/more", title: t("Treasury.title"), nav: <TreasuryTabs current="bank" /> } as const;
  if (!result.ok) return <Page {...shell}><p>{t("Bank.forbidden")}</p></Page>;
  const { canWrite, accounts, account, statements, statement: s } = result.value;
  const day = (d: string) => formatDay(d as FarmDay, lang);
  // FC9: a statement line not in the books is booked where it belongs: a debit as bank fees (T119) on /expenses, the
  // rest by the owner's manual entry (FCX3) on /books, its 5141 line on this account. Prefilled, the user checks it.
  const bookIt = (l: { day: string; label: string; amountCentimes: bigint }, accountId: string): { pathname: string; query: Record<string, string> } | false =>
    l.amountCentimes < 0n
      ? canWrite && { pathname: "/expenses", query: { category: "bank_fees", amount: typed(l.amountCentimes), day: l.day, from: accountId } }
      : can(ctx.value, "finance.manage") && { pathname: "/books", query: { day: l.day, label: l.label.slice(0, 200), debit: typed(l.amountCentimes), bank: accountId } };
  // A new key once a statement is added or imported (the actions redirect to it): the sheet that sent it closes.
  const sheetKey = `${account?.id}:${statements.length}:${s?.id}`;
  const actions = canWrite && account && (
    <>
      <SheetButton key={`add:${sheetKey}`} label={t("Bank.add")} title={t("Bank.add")}>
        <StatementForm treasuryId={account.id} today={farmDayOf(new Date())} />
      </SheetButton>
      <SheetButton key={`import:${sheetKey}`} label={t("Bank.import")} title={t("Bank.import")}>
        <ImportForm treasuryId={account.id} today={farmDayOf(new Date())} maxBytes={IMPORT_MAX_BYTES} />
      </SheetButton>
    </>
  );

  if (!account) return <Page {...shell}><p className={empty}>{t("Bank.noAccount")}</p></Page>;
  const tab = pickTab(["open", "all"], search.tab);
  const shared = { account: account.id, ...(s ? { statement: s.id } : {}) };
  const open = s ? s.lines.filter((l) => !l.ticked && !l.tickedOn) : [];
  const lines = tab === "open" ? open : (s?.lines ?? []);
  const imported = s ? (tab === "open" ? s.imported.filter((l) => !l.ticked) : s.imported) : [];
  const page = pageOf(search.page, lines.length, TABLE_PAGE);
  const ipage = pageOf(search.ipage, imported.length, TABLE_PAGE);
  // shortcut: in-memory page slices of one statement's lines, move to skip/take in bankReconciliation past ~1 000 lines
  const slice = <T,>(rows: T[], n: number) => rows.slice((n - 1) * TABLE_PAGE, n * TABLE_PAGE);
  const href = (more: Record<string, string | number>) => ({ pathname: "/treasury/bank", query: { ...shared, tab, ...more } });

  return (
    <Page {...shell} actions={actions}>
      {accounts.length > 1 && (
        <nav className="flex flex-wrap gap-x-4" aria-label={t("Bank.accounts")}>
          {accounts.map((a) => (
            <Link key={a.id} href={{ pathname: "/treasury/bank", query: { account: a.id } }} aria-current={a.id === account.id ? "page" : undefined} className={`inline-flex min-h-11 items-center ${a.id === account.id ? "font-semibold" : "underline underline-offset-4"}`}>
              {a.name}
            </Link>
          ))}
        </nav>
      )}
      <section className="flex flex-col gap-2" aria-labelledby="statements">
        <h2 id="statements" className={sectionTitle}>{t("Bank.statements")} · {account.name}</h2>
        {statements.length === 0 ? (
          <p className={empty}>{t("Bank.noStatement")}</p>
        ) : (
          <nav className="flex flex-wrap gap-x-4" aria-label={t("Bank.statements")}>
            {statements.map((x) => (
              <Link key={x.id} href={{ pathname: "/treasury/bank", query: { account: account.id, statement: x.id } }} aria-current={x.id === s?.id ? "page" : undefined} className={`inline-flex min-h-11 items-center ${x.id === s?.id ? "font-semibold" : "underline underline-offset-4"}`}>
                {t("Bank.statementOf", { day: day(x.endDay) })}
              </Link>
            ))}
          </nav>
        )}
      </section>
      {s && (
        <>
          <section className={`${card} gap-3`} aria-labelledby="reconciliation">
            <h2 id="reconciliation" className={sectionTitle}>{t("Bank.statementOf", { day: day(s.endDay) })}</h2>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(
                [
                  [t("Bank.statementBalance"), s.closingCentimes],
                  [t("Bank.bookBalance", { day: day(s.endDay) }), s.bookCentimes],
                  [t("Bank.ticked"), s.tickedCentimes],
                  [t("Bank.difference"), s.differenceCentimes],
                ] as const
              ).map(([term, amount]) => (
                <div key={term} className="flex flex-col gap-1">
                  <dt className="text-sm text-ink-2">{term}</dt>
                  <dd className="text-lg font-semibold tabular-nums"><bdi dir="ltr">{formatMoney(amount)}</bdi></dd>
                </div>
              ))}
            </dl>
            <p role="status" className={s.reconciled ? done : warn}>{t(s.reconciled ? "Bank.reconciled" : "Bank.notReconciled")}</p>
            {!s.reconciled && <p className="max-w-prose text-sm text-ink-2">{t("Bank.differenceNote")}</p>}
          </section>
          <Tabs
            label={t("Bank.filter")}
            current={tab}
            tabs={[
              { key: "open", label: t("Bank.toTick"), count: open.length, href: { pathname: "/treasury/bank", query: { ...shared, tab: "open" } } },
              { key: "all", label: t("Bank.all"), count: s.lines.length, href: { pathname: "/treasury/bank", query: { ...shared, tab: "all" } } },
            ]}
          />
          {/* Wide screens: the imported statement's lines beside the book lines */}
          <div className={`flex flex-col gap-5 ${s.imported.length > 0 ? "lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8" : ""}`}>
            {s.imported.length > 0 && (
              <section className="flex flex-col gap-2" aria-labelledby="imported">
                <h3 id="imported" className="font-semibold">{t("Bank.imported")}</h3>
                <p className="max-w-prose text-sm text-ink-2">{t("Bank.importedNote")}</p>
                {imported.length === 0 ? (
                  <p className={empty}>{t("Bank.allTicked")}</p>
                ) : (
                  <ImportedTable
                    statementId={s.id}
                    canWrite={canWrite}
                    lines={slice(imported, ipage).map((l) => ({ id: l.id, day: day(l.day), label: l.label, amount: formatMoney(l.amountCentimes), lineId: l.lineId, ticked: l.ticked, book: (!l.lineId && bookIt(l, account.id)) || null, byOwner: !l.lineId && canWrite && l.amountCentimes >= 0n && !can(ctx.value, "finance.manage") }))}
                  />
                )}
                <Pager page={ipage} size={TABLE_PAGE} total={imported.length} href={(n) => href({ page, ipage: n })} />
              </section>
            )}
            <section className="flex flex-col gap-2" aria-labelledby="book-lines">
              <h3 id="book-lines" className="font-semibold">{t("Bank.lines", { day: day(s.endDay) })}</h3>
              {s.lines.length === 0 ? (
                <p className={empty}>{t("Bank.none")}</p>
              ) : lines.length === 0 ? (
                <p className={empty}>{t("Bank.allTicked")}</p>
              ) : (
                <MatchTable
                  statementId={s.id}
                  canWrite={canWrite}
                  lines={slice(lines, page).map((l) => ({
                    id: l.id,
                    day: day(l.day),
                    journal: l.journal,
                    label: l.label,
                    amount: formatMoney(l.debitCentimes - l.creditCentimes), // in +, out −
                    ticked: l.ticked,
                    tickedOn: l.tickedOn && day(l.tickedOn),
                  }))}
                />
              )}
              <Pager page={page} size={TABLE_PAGE} total={lines.length} href={(n) => href({ page: n, ipage })} />
            </section>
          </div>
        </>
      )}
    </Page>
  );
}
