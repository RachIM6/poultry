import { headers } from "next/headers";
import { locale } from "next/root-params";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Page } from "@/components/page";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { typedCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import { bankReconciliation, IMPORT_MAX_BYTES } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { done, warn } from "@/components/ui";
import { ImportedTable, ImportForm, MatchTable, StatementForm } from "./forms";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Bank", "Nav", "Offline", "Sync.refused", "Treasury.label", "errors"];

// SPEC-finance FC9, FCX1, FCX2: bank reconciliation by manual matching. Online, server-rendered from the ledger.
// Owner and manager tick; the accountant reads; workers are refused by finance.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default function BankPage({ searchParams }: { searchParams: Search }) {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <Page width="wide" back="/treasury" title={t("Bank.title")}>
        <Suspense>
          <Bank searchParams={searchParams} />
        </Suspense>
      </Page>
    </ClientMessages>
  );
}

// Wide screens, master-detail: the statements and their two forms in a 360 px column, the open statement's matching
// beside them. The grid places each block, the DOM order (the phone's) stays. The matching spans the rows; the last
// one, 1fr, takes what it needs beyond the column, so the statements and forms stay together at the top.
const master = "flex flex-col gap-5 lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto_1fr] lg:items-start lg:gap-x-8";
const side = "lg:col-start-1";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
/** Centimes as the forms take them: 45.00, without its sign. */
const typed = (c: bigint) => typedCentimes(c < 0n ? -c : c, ".");

async function Bank({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const result = await bankReconciliation(ctx.value, one(search.account), one(search.statement));
  if (!result.ok) return <p>{t("Bank.forbidden")}</p>;
  const { canWrite, accounts, account, statements, statement: s } = result.value;
  const day = (d: string) => formatDay(d as FarmDay, lang);
  // FC9: a statement line not in the books is booked where it belongs: a debit as bank fees (T119) on /expenses, the
  // rest by the owner's manual entry (FCX3) on /books, its 5141 line on this account. Prefilled, the user checks it.
  const bookIt = (l: { day: string; label: string; amountCentimes: bigint }, accountId: string): { pathname: string; query: Record<string, string> } | false =>
    l.amountCentimes < 0n
      ? canWrite && { pathname: "/expenses", query: { category: "bank_fees", amount: typed(l.amountCentimes), day: l.day, from: accountId } }
      : can(ctx.value, "finance.manage") && { pathname: "/books", query: { day: l.day, label: l.label.slice(0, 200), debit: typed(l.amountCentimes), bank: accountId } };

  return (
    <>
      {!account ? (
        <p>{t("Bank.noAccount")}</p>
      ) : (
        <>
          {accounts.length > 1 && (
            <nav className="flex flex-wrap gap-3" aria-label={t("Bank.accounts")}>
              {accounts.map((a) => (
                <Link key={a.id} href={{ pathname: "/treasury/bank", query: { account: a.id } }} aria-current={a.id === account.id ? "page" : undefined} className={a.id === account.id ? "font-semibold" : "underline underline-offset-4"}>
                  {a.name}
                </Link>
              ))}
            </nav>
          )}
          <div className={master}>
            <section className={`flex flex-col gap-2 ${side}`} aria-labelledby="statements">
              <h2 id="statements" className="text-[17px] font-semibold text-ink-2">{t("Bank.statements")} · {account.name}</h2>
              {statements.length === 0 ? (
                <p>{t("Bank.noStatement")}</p>
              ) : (
                <nav className="flex flex-wrap gap-3 lg:flex-col lg:gap-0" aria-label={t("Bank.statements")}>
                  {statements.map((x) => (
                    <Link key={x.id} href={{ pathname: "/treasury/bank", query: { account: account.id, statement: x.id } }} aria-current={x.id === s?.id ? "page" : undefined} className={`inline-flex min-h-11 items-center ${x.id === s?.id ? "font-semibold" : "underline underline-offset-4"}`}>
                      {t("Bank.statementOf", { day: day(x.endDay) })}
                    </Link>
                  ))}
                </nav>
              )}
            </section>
            {s && (
              <section className="flex flex-col gap-3 lg:col-start-2 lg:row-span-4 lg:row-start-1" aria-labelledby="reconciliation">
                <h2 id="reconciliation" className="text-lg font-semibold">{t("Bank.statementOf", { day: day(s.endDay) })}</h2>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                  <dt>{t("Bank.statementBalance")}</dt>
                  <dd className="text-end tabular-nums"><bdi dir="ltr">{formatMoney(s.closingCentimes)}</bdi></dd>
                  <dt>{t("Bank.bookBalance", { day: day(s.endDay) })}</dt>
                  <dd className="text-end tabular-nums"><bdi dir="ltr">{formatMoney(s.bookCentimes)}</bdi></dd>
                  <dt>{t("Bank.ticked")}</dt>
                  <dd className="text-end tabular-nums"><bdi dir="ltr">{formatMoney(s.tickedCentimes)}</bdi></dd>
                  <dt className="font-semibold">{t("Bank.difference")}</dt>
                  <dd className="text-end font-semibold tabular-nums"><bdi dir="ltr">{formatMoney(s.differenceCentimes)}</bdi></dd>
                </dl>
                <p role="status" className={s.reconciled ? done : warn}>{t(s.reconciled ? "Bank.reconciled" : "Bank.notReconciled")}</p>
                {!s.reconciled && <p className="max-w-prose text-sm text-ink-2">{t("Bank.differenceNote")}</p>}
                {s.imported.length > 0 && (
                  <>
                    <h3 className="font-semibold text-ink-2">{t("Bank.imported")}</h3>
                    <p className="max-w-prose text-sm text-ink-2">{t("Bank.importedNote")}</p>
                    <ImportedTable
                      statementId={s.id}
                      canWrite={canWrite}
                      lines={s.imported.map((l) => ({ id: l.id, day: day(l.day), label: l.label, amount: formatMoney(l.amountCentimes), lineId: l.lineId, ticked: l.ticked, book: (!l.lineId && bookIt(l, account.id)) || null, byOwner: !l.lineId && canWrite && l.amountCentimes >= 0n && !can(ctx.value, "finance.manage") }))}
                    />
                  </>
                )}
                <h3 className="font-semibold text-ink-2">{t("Bank.lines", { day: day(s.endDay) })}</h3>
                {s.lines.length === 0 ? (
                  <p>{t("Bank.none")}</p>
                ) : (
                  <MatchTable
                    statementId={s.id}
                    canWrite={canWrite}
                    lines={s.lines.map((l) => ({
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
              </section>
            )}
            {canWrite && (
              <section className={`flex flex-col gap-2 ${side}`} aria-labelledby="add-statement">
                <h2 id="add-statement" className="text-[17px] font-semibold text-ink-2">{t("Bank.add")}</h2>
                <StatementForm key={account.id} treasuryId={account.id} today={farmDayOf(new Date())} />
              </section>
            )}
            {canWrite && (
              <section className={`flex flex-col gap-2 ${side}`} aria-labelledby="import-statement">
                <h2 id="import-statement" className="text-[17px] font-semibold text-ink-2">{t("Bank.import")}</h2>
                <ImportForm key={account.id} treasuryId={account.id} today={farmDayOf(new Date())} maxBytes={IMPORT_MAX_BYTES} />
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
