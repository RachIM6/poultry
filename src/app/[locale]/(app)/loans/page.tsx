import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Page } from "@/components/page";
import { card, field, table, warn } from "@/components/ui";
import { Num } from "@/components/num";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { typedCentimes } from "@/lib/kernel/money";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { loanRegister, subsidyRegister, type LoanView, type SubsidyView } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { LoanActionForm, LoanForm, ScheduleForm, SubsidyForm } from "./form";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Loans", "Nav", "Offline", "Subsidies", "Sync.refused", "errors"];

// SPEC-finance FC2 (T105, T106), FCX2: "Emprunts et subventions", online like /books. Each loan's schedule with its
// paid and due installments, and each subsidy with its release by year. The owner writes; a manager marks installments
// paid; the accountant reads.
export default function LoansPage() {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/more" />}>
        <LoansView />
      </Suspense>
    </ClientMessages>
  );
}

/** 5 550 (1/100 000) → "5,55". */
const percent = (rate: number) => `${Math.floor(rate / 1000)}${rate % 1000 ? `,${String(rate % 1000).padStart(3, "0").replace(/0+$/, "")}` : ""}`;

async function LoansView() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const [result, grants] = await Promise.all([loanRegister(ctx.value), subsidyRegister(ctx.value)]);
  if (!result.ok || !grants.ok) return <Page width="wide" back="/more"><p>{t("Loans.forbidden")}</p></Page>;
  const { books, loans, banks } = result.value;
  const { subsidies, assets } = grants.value;
  const owner = can(ctx.value, "finance.manage");
  const payer = can(ctx.value, "finance.record");
  const today = farmDayOf(new Date());
  const day = (d: string) => formatDay(d as FarmDay, lang);
  const money = (c: bigint) => <bdi dir="ltr" className="tabular-nums">{formatMoney(c)}</bdi>;

  return (
    <Page width="wide" back="/more" title={t("Loans.title")} subtitle={<span className="block max-w-prose">{t("Loans.hint")}</span>}>
      {owner && (
        <details className={card}>
          <summary className="disclosure font-semibold">{t("Loans.add")}</summary>
          {banks.length === 0 ? (
            <p className={warn}>
              {t("Loans.noBank")} <Link href="/expenses" className="underline underline-offset-4">{t("Expenses.open")}</Link>
            </p>
          ) : (
            <LoanForm today={today} banks={banks} />
          )}
        </details>
      )}
      {loans.length === 0 ? <p>{t("Loans.none")}</p> : loans.map((l) => <Loan key={l.id} l={l} />)}

      <h2 className="text-xl font-semibold">{t("Subsidies.title")}</h2>
      <p className="max-w-prose text-sm text-ink-2">{t(books === "ledger" ? "Subsidies.hint" : "Subsidies.cashBook")}</p>
      {owner && (
        <details className={card}>
          <summary className="disclosure font-semibold">{t("Subsidies.add")}</summary>
          {banks.length === 0 ? (
            <p className={warn}>
              {t("Loans.noBank")} <Link href="/expenses" className="underline underline-offset-4">{t("Expenses.open")}</Link>
            </p>
          ) : assets.length === 0 ? (
            <p className={warn}>
              {t("Subsidies.noAsset")} <Link href="/assets" className="underline underline-offset-4">{t("Assets.open")}</Link>
            </p>
          ) : (
            <SubsidyForm today={today} banks={banks} assets={assets} />
          )}
        </details>
      )}
      {subsidies.length === 0 ? <p>{t("Subsidies.none")}</p> : subsidies.map((s) => <Subsidy key={s.id} s={s} />)}
    </Page>
  );

  function Subsidy({ s }: { s: SubsidyView }) {
    const name = t("Subsidies.releaseOf", { label: s.label });
    return (
      <section aria-label={s.label} className={card}>
        <h3 className="text-lg font-semibold">{s.label}</h3>
        <p className="text-sm text-ink-2">{t("Subsidies.terms", { grantor: s.grantor, amount: formatMoney(s.amount), day: day(s.receivedOn), bank: s.bank })}</p>
        <p>{t("Subsidies.financed", { assets: s.assets.join(", ") })}</p>
        {s.inalienableYears !== null && <p>{t("Subsidies.inalienable", { years: s.inalienableYears })}</p>}
        <div className="relative overflow-x-auto">
          <table className={table} aria-label={name}>
            <caption className="p-2 text-start font-semibold">{name}</caption>
            <thead>
              <tr>
                <th className="p-2 text-start">{t("Subsidies.year")}</th>
                <th className="p-2 text-end">{t("Subsidies.release")}</th>
                <th className="p-2 text-end">{t("Subsidies.released")}</th>
                <th className="p-2 text-end">{t("Subsidies.left")}</th>
              </tr>
            </thead>
            <tbody>
              {s.years.map((y) => (
                <tr key={y.from} className="border-t border-line">
                  <td className="p-2"><bdi dir="ltr" className="tabular-nums">{y.from.slice(0, 4) === y.to.slice(0, 4) ? y.from.slice(0, 4) : `${y.from.slice(0, 4)}–${y.to.slice(0, 4)}`}</bdi></td>
                  <Num>{formatMoney(y.release)}</Num>
                  <Num>{formatMoney(y.released)}</Num>
                  <Num>{formatMoney(s.amount - y.released)}</Num>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function Loan({ l }: { l: LoanView }) {
    const draft = !l.confirmed && owner;
    const rows = (
      <div className="relative overflow-x-auto">
        <table className={table} aria-label={t("Loans.schedule", { lender: l.lender })}>
          <caption className="p-2 text-start font-semibold">{t("Loans.schedule", { lender: l.lender })}</caption>
          <thead>
            <tr>
              <th className="p-2 text-start">{t("Loans.number")}</th>
              <th className="p-2 text-start">{t("Loans.dueOn")}</th>
              <th className="p-2 text-end">{t("Loans.outstanding")}</th>
              <th className="p-2 text-end">{t("Loans.interest")}</th>
              <th className="p-2 text-end">{t("Loans.capital")}</th>
              <th className="p-2 text-end">{t("Loans.total")}</th>
              {l.confirmed && <th className="p-2 text-start">{t("Loans.state")}</th>}
            </tr>
          </thead>
          <tbody>
            {l.rows.map((r) => (
              <tr key={r.number} className="border-t border-line">
                <td className="p-2 tabular-nums">{r.number}</td>
                <td className="whitespace-nowrap p-2">{day(r.dueOn)}</td>
                <Num>{formatMoney(r.outstandingBefore)}</Num>
                {draft ? (
                  <>
                    <td className="p-2">
                      <input type="hidden" name="number" value={r.number} />
                      <input name={`interest-${r.number}`} defaultValue={typedCentimes(r.interest)} aria-label={t("Loans.interestOf", { number: r.number })} inputMode="decimal" required dir="ltr" className={`${field} w-36 text-end`} />
                    </td>
                    <td className="p-2">
                      <input name={`capital-${r.number}`} defaultValue={typedCentimes(r.capital)} aria-label={t("Loans.capitalOf", { number: r.number })} inputMode="decimal" required dir="ltr" className={`${field} w-36 text-end`} />
                    </td>
                  </>
                ) : (
                  <>
                    <Num>{formatMoney(r.interest)}</Num>
                    <Num>{formatMoney(r.capital)}</Num>
                  </>
                )}
                <Num>{formatMoney(r.capital + r.interest)}</Num>
                {l.confirmed && (
                  <td className="p-2">
                    {r.paidOn ? (
                      t("Loans.paidOn", { day: day(r.paidOn) })
                    ) : payer && r.dueOn <= today ? (
                      <LoanActionForm kind="pay" submit={t("Loans.pay")}>
                        <input type="hidden" name="loanId" value={l.id} />
                        <input type="hidden" name="number" value={r.number} />
                        <input type="date" name="day" defaultValue={r.dueOn} min={r.dueOn} max={today} required aria-label={t("Loans.payDay", { number: r.number })} className={field} />
                      </LoanActionForm>
                    ) : (
                      t(r.dueOn <= today ? "Loans.due" : "Loans.upcoming")
                    )}
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t-2 border-line font-semibold">
              <td className="p-2" colSpan={3}>{t("Loans.totals")}</td>
              <Num>{formatMoney(l.rows.reduce((s, r) => s + r.interest, 0n))}</Num>
              <Num>{formatMoney(l.rows.reduce((s, r) => s + r.capital, 0n))}</Num>
              <Num>{formatMoney(l.rows.reduce((s, r) => s + r.capital + r.interest, 0n))}</Num>
              {l.confirmed && <td />}
            </tr>
          </tbody>
        </table>
      </div>
    );
    return (
      <section aria-label={l.lender} className={card}>
        <h2 className="text-xl font-semibold">{l.lender}</h2>
        <p className="text-sm text-ink-2">
          {t("Loans.terms", { bank: l.bank, principal: formatMoney(l.principal), rate: percent(l.rate), frequency: l.frequency, installments: l.installments, deferral: l.deferral })}
          {" · "}
          {l.disbursedOn ? t("Loans.disbursed", { day: day(l.disbursedOn) }) : t("Loans.inOpening")}
        </p>
        {l.confirmed ? (
          <p>{t("Loans.owed")} {money(l.owed)}</p>
        ) : (
          <p className={warn}>{t("Loans.draft", { principal: formatMoney(l.principal) })}</p>
        )}
        {draft ? <ScheduleForm loanId={l.id}>{rows}</ScheduleForm> : rows}
        {draft && (
          <LoanActionForm kind="discard" submit={t("Loans.discard")}>
            <input type="hidden" name="loanId" value={l.id} />
          </LoanActionForm>
        )}
      </section>
    );
  }
}
