import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BackLink } from "@/components/app-nav";
import { card, field, table, warn } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { loanRegister, subsidyRegister, type LoanView, type SubsidyView } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { LoanActionForm, LoanForm, ScheduleForm, SubsidyForm } from "./form";

// SPEC-finance FC2 (T105, T106), FCX2: "Emprunts et subventions", online like /books. Each loan's schedule with its
// paid and due installments, and each subsidy with its release by year. The owner writes; a manager marks installments
// paid; the accountant reads.
export default function LoansPage() {
  return (
    <>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <LoansView />
        </Suspense>
      </main>
    </>
  );
}

/** 5 550 (1/100 000) → "5,55". */
const percent = (rate: number) => `${Math.floor(rate / 1000)}${rate % 1000 ? `,${String(rate % 1000).padStart(3, "0").replace(/0+$/, "")}` : ""}`;
/** Centimes as typed back into a field: "16666,67". */
const typed = (c: bigint) => `${c / 100n},${String(c % 100n).padStart(2, "0")}`;

async function LoansView() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const [result, grants] = await Promise.all([loanRegister(ctx.value), subsidyRegister(ctx.value)]);
  if (!result.ok || !grants.ok) return <p>{t("Expenses.forbidden")}</p>;
  const { books, loans, banks } = result.value;
  const { subsidies, assets } = grants.value;
  const owner = can(ctx.value, "finance.manage");
  const payer = can(ctx.value, "finance.record");
  const today = farmDayOf(new Date());
  const day = (d: string) => formatDay(d as FarmDay, lang);
  const money = (c: bigint) => <bdi dir="ltr" className="tabular-nums">{formatMoney(c)}</bdi>;

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Loans.title")}</h1>
      <p className="text-sm text-ink-2">{t("Loans.hint")}</p>
      {owner && (
        <details className={card}>
          <summary className="cursor-pointer font-semibold">{t("Loans.add")}</summary>
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
      <p className="text-sm text-ink-2">{t(books === "ledger" ? "Subsidies.hint" : "Subsidies.cashBook")}</p>
      {owner && (
        <details className={card}>
          <summary className="cursor-pointer font-semibold">{t("Subsidies.add")}</summary>
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
    </>
  );

  function Subsidy({ s }: { s: SubsidyView }) {
    const name = t("Subsidies.releaseOf", { label: s.label });
    return (
      <section aria-label={s.label} className={card}>
        <h3 className="text-lg font-semibold">{s.label}</h3>
        <p className="text-sm text-ink-2">{t("Subsidies.terms", { grantor: s.grantor, amount: formatMoney(s.amount), day: day(s.receivedOn), bank: s.bank })}</p>
        <p>{t("Subsidies.financed", { assets: s.assets.join(", ") })}</p>
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
                  <td dir="ltr" className="p-2 text-start tabular-nums">{y.from.slice(0, 4) === y.to.slice(0, 4) ? y.from.slice(0, 4) : `${y.from.slice(0, 4)}–${y.to.slice(0, 4)}`}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(y.release)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(y.released)}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(s.amount - y.released)}</td>
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
                <td dir="ltr" className="p-2 tabular-nums">{r.number}</td>
                <td className="whitespace-nowrap p-2">{day(r.dueOn)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(r.outstandingBefore)}</td>
                {draft ? (
                  <>
                    <td className="p-2">
                      <input type="hidden" name="number" value={r.number} />
                      <input name={`interest-${r.number}`} defaultValue={typed(r.interest)} aria-label={t("Loans.interestOf", { number: r.number })} inputMode="decimal" required dir="ltr" className={`${field} w-36 text-end`} />
                    </td>
                    <td className="p-2">
                      <input name={`capital-${r.number}`} defaultValue={typed(r.capital)} aria-label={t("Loans.capitalOf", { number: r.number })} inputMode="decimal" required dir="ltr" className={`${field} w-36 text-end`} />
                    </td>
                  </>
                ) : (
                  <>
                    <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(r.interest)}</td>
                    <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(r.capital)}</td>
                  </>
                )}
                <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(r.capital + r.interest)}</td>
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
              <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(l.rows.reduce((s, r) => s + r.interest, 0n))}</td>
              <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(l.rows.reduce((s, r) => s + r.capital, 0n))}</td>
              <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(l.rows.reduce((s, r) => s + r.capital + r.interest, 0n))}</td>
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
