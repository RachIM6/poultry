import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { associateAccount, cashForecast, catchUpBooks, creditExpensesToPay, placementsToPay, treasuryOverview } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { BackLink } from "@/components/app-nav";
import { card, field, table } from "@/components/ui";
import { Num, Scroll } from "@/components/num";
import { payCreditExpenseAction, payPlacementAction, recordAssociateAction } from "./actions";
import { TreasuryForm } from "./pay-form";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Nav", "Offline", "Sync.refused", "Treasury.associateSaved", "Treasury.paid", "errors"];

// SPEC-finance FN10: an online page for the owner and the manager (the web side of SPEC's split): each bank account's
// and cash box's balance, and this month's movements on 5141 / 5161. Server-rendered from the ledger, never cached.
export default function TreasuryPage() {
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Treasury />
        </Suspense>
      </main>
    </ClientMessages>
  );
}

// The schedule's weeks: the year goes without saying ("20 nov."). Here, not in lib/format: /batches ships that file.
const dayMonth = (day: string, lang: string) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

async function Treasury() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const today = farmDayOf(new Date());
  const canPay = can(ctx.value, "finance.record"); // the accountant reads the lists to pay, without the forms (SPEC-m5 PA5)
  const month = today.slice(0, 7);
  await catchUpBooks(ctx.value); // SPEC-finance §9: once, so every read below sees the same, caught-up books
  const [overview, forecast, toPay, expensesToPay, owners] = await Promise.all([
    treasuryOverview(ctx.value, month),
    cashForecast(ctx.value),
    placementsToPay(ctx.value),
    creditExpensesToPay(ctx.value),
    associateAccount(ctx.value), // the owner only
  ]);
  if (!overview.ok || !forecast.ok) return <p>{t("Treasury.forbidden")}</p>;
  const { accounts, unassignedCentimes, movements } = overview.value;
  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? t(id === null ? "Treasury.untagged" : "Treasury.unknown");
  const total = accounts.reduce((s, a) => s + a.balanceCentimes, unassignedCentimes); // the forecast's start
  const label = (text: string, input: ReactNode) => (
    <label className="flex flex-col gap-1">
      {text}
      {input}
    </label>
  );
  // A debt's pay form (placement, credit expense): day, amount, how, from which cash box or bank account.
  const payForm = (action: typeof payPlacementAction, name: string, hidden: ReactNode) => (
    <details className="rounded-2xl border border-line p-3">
      <summary aria-label={t("Treasury.payOf", { name })} className="min-h-11 cursor-pointer py-2.5">{t("Treasury.pay")}</summary>
      <div className="pt-3">
        <TreasuryForm action={action} submit={t("Assets.paySave")}>
          {hidden}
          <input type="hidden" name="id" value={uuidv7()} />
          {label(t("Assets.payDay"), <input type="date" name="day" defaultValue={today} max={today} required className={field} />)}
          {label(t("Assets.payAmount"), <input name="amount" inputMode="decimal" required dir="ltr" className={field} />)}
          {label(
            t("Assets.paidWith"),
            <select name="paidWith" required defaultValue="" className={field}>
              <option value="" disabled>—</option>
              {(["cash", "transfer", "cheque"] as const).map((m) => <option key={m} value={m}>{t(`Assets.methods.${m}`)}</option>)}
            </select>,
          )}
          {label(
            t("Assets.treasury"),
            <select name="treasuryId" defaultValue="" className={field}>
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>,
          )}
        </TreasuryForm>
      </div>
    </details>
  );
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Treasury.title")}</h1>
      <ul className="flex flex-col gap-2" aria-label={t("Treasury.balances")}>
        {accounts.map((a) => (
          <li key={a.id} className="flex justify-between gap-4 rounded-2xl border border-line bg-card p-3">
            <span>{t(`Expenses.kinds.${a.kind}`)} · {a.name}</span>
            <span dir="ltr" className="font-semibold tabular-nums">{formatMoney(a.balanceCentimes)}</span>
          </li>
        ))}
        {unassignedCentimes !== 0n && (
          <li className="flex justify-between gap-4 rounded-2xl border border-line bg-card p-3">
            <span>{t("Treasury.unassigned")}</span>
            <span dir="ltr" className="font-semibold tabular-nums">{formatMoney(unassignedCentimes)}</span>
          </li>
        )}
        <li className="flex justify-between gap-4 p-3 font-semibold">
          <span>{t("Treasury.total")}</span>
          <span dir="ltr" className="tabular-nums">{formatMoney(total)}</span>
        </li>
      </ul>
      {/* F-Effects: the next weeks' cash, from today's cash and bank and what falls due */}
      <section className="flex flex-col gap-2" aria-labelledby="schedule">
        <h2 id="schedule" className="text-[17px] font-semibold text-ink-2">{t("Treasury.schedule")}</h2>
        <p className="text-sm text-ink-2">{t("Treasury.scheduleStart", { amount: formatMoney(forecast.value.startCentimes) })}</p>
        <Scroll label={t("Treasury.schedule")}>
          <table className={table} aria-label={t("Treasury.schedule")}>
            <thead>
              <tr>
                <th className="p-2 text-start">{t("Treasury.weekOf")}</th>
                <th className="p-2 text-end">{t("Treasury.inflow")}</th>
                <th className="p-2 text-end">{t("Treasury.outflow")}</th>
                <th className="p-2 text-end">{t("Treasury.cashAfter")}</th>
              </tr>
            </thead>
            <tbody>
              {forecast.value.weeks.map((w) => (
                <tr key={w.from} className={`border-t border-line ${w.afterCentimes < 0n ? "font-semibold text-brick-fg" : ""}`}>
                  <td className="whitespace-nowrap p-2">{dayMonth(w.from, lang)}</td>
                  <Num>{w.inCentimes === 0n ? "" : formatMoney(w.inCentimes)}</Num>
                  <Num>{w.outCentimes === 0n ? "" : formatMoney(w.outCentimes)}</Num>
                  <Num>{formatMoney(w.afterCentimes)}</Num>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
        <p className="text-sm text-ink-2">{t("Treasury.scheduleNote")}</p>
      </section>
      {/* SPEC-finance §9 "Placement debts": the chicks or point-of-lay hens still owed, paid here (owner, manager; the accountant reads) */}
      {toPay.ok && toPay.value.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="placements">
          <h2 id="placements" className="text-[17px] font-semibold text-ink-2">{t("Treasury.placements")}</h2>
          <p className="text-sm text-ink-2">{t("Treasury.placementsHint")}</p>
          {toPay.value.map((p) => (
            <article key={p.batchId} className={card}>
              <p className="font-semibold">{p.hatchery}</p>
              <p className="text-sm text-ink-2">{p.place} · {t("Treasury.placedOn", { day: formatDay(p.placedOn, lang) })} · <bdi dir="ltr">{p.account}</bdi></p>
              <p>{t("Treasury.owed", { amount: formatMoney(p.owed) })}</p>
              {canPay && payForm(payPlacementAction, p.hatchery, <input type="hidden" name="batchId" value={p.batchId} />)}
            </article>
          ))}
        </section>
      )}
      {/* SPEC-finance §9 "Credit expenses": the quick expenses recorded on credit still owed, paid here (owner, manager; the accountant reads) */}
      {expensesToPay.ok && expensesToPay.value.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="credit-expenses">
          <h2 id="credit-expenses" className="text-[17px] font-semibold text-ink-2">{t("Treasury.creditExpenses")}</h2>
          <p className="text-sm text-ink-2">{t("Treasury.creditExpensesHint")}</p>
          {expensesToPay.value.map((e) => (
            <article key={e.expenseId} className={card}>
              <p className="font-semibold">{t(`Expenses.categories.${e.category}`)}</p>
              <p className="text-sm text-ink-2">{formatDay(e.day, lang)}{e.note && <> · {e.note}</>} · <bdi dir="ltr">{e.account}</bdi></p>
              <p>{t("Treasury.owed", { amount: formatMoney(e.owed) })}</p>
              {canPay && payForm(payCreditExpenseAction, `${t(`Expenses.categories.${e.category}`)} · ${formatDay(e.day, lang)}`, <input type="hidden" name="expenseId" value={e.expenseId} />)}
            </article>
          ))}
        </section>
      )}
      {/* SPEC-finance FN6, FQ11 (§9 "Associate contributions"): money an associate or the exploitant brings in or takes out (owner) */}
      {owners.ok && (
        <section className="flex flex-col gap-2" aria-labelledby="associate">
          <h2 id="associate" className="text-[17px] font-semibold text-ink-2">{t(owners.value.individual ? "Treasury.exploitant" : "Treasury.associate")}</h2>
          <p className="text-sm text-ink-2">{t(owners.value.individual ? "Treasury.exploitantHint" : "Treasury.associateHint", { account: owners.value.account })}</p>
          {accounts.length === 0 ? (
            <p>{t("Treasury.associateNoAccount")}</p>
          ) : (
            <TreasuryForm action={recordAssociateAction} submit={t("Treasury.associateSave")}>
              <input type="hidden" name="id" value={uuidv7()} />
              {label(
                t("Treasury.direction"),
                <select name="direction" required defaultValue="contribution" className={field}>
                  {(["contribution", "withdrawal"] as const).map((d) => <option key={d} value={d}>{t(`Treasury.directions.${d}`)}</option>)}
                </select>,
              )}
              {label(t("Treasury.day"), <input type="date" name="day" defaultValue={today} max={today} required className={field} />)}
              {label(t("Treasury.amount"), <input name="amount" inputMode="decimal" required dir="ltr" className={field} />)}
              {label(
                t("Treasury.into"),
                <select name="treasuryId" required defaultValue="" className={field}>
                  <option value="" disabled>—</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{t(`Expenses.kinds.${a.kind}`)} · {a.name}</option>)}
                </select>,
              )}
              {!owners.value.individual && label(t("Treasury.associateName"), <input name="associate" maxLength={80} className={field} />)}
            </TreasuryForm>
          )}
        </section>
      )}
      {/* SPEC-finance FC9: ticking each bank account's lines against its statements */}
      <Link href="/treasury/bank" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("Bank.open")}</Link>
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Treasury.movements")}</h2>
      {movements.length === 0 ? (
        <p>{t("Treasury.none")}</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className={table} aria-label={t("Treasury.movements")}>
            <thead>
              <tr className="text-start">
                <th className="p-2 text-start">{t("Treasury.day")}</th>
                <th className="p-2 text-start">{t("Treasury.journal")}</th>
                <th className="p-2 text-start">{t("Treasury.label")}</th>
                <th className="p-2 text-start">{t("Treasury.account")}</th>
                <th className="p-2 text-start">{t("Treasury.counterAccount")}</th>
                <th className="p-2 text-start">{t("Treasury.batch")}</th>
                <th className="p-2 text-end">{t("Treasury.in")}</th>
                <th className="p-2 text-end">{t("Treasury.out")}</th>
                <th className="p-2 text-start">{t("Treasury.receipt")}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="p-2">{formatDay(m.day as FarmDay, lang)}</td>
                  <td className="p-2">{m.journal}</td>
                  <td className="p-2">{m.label}</td>
                  <td className="p-2">{nameOf(m.treasuryId)}</td>
                  {/* FN10, as the cash book shows them (FN16): the account's label, its number when the chart has none */}
                  <td className="p-2">{m.counterAccounts.map((c) => c.label || c.number).join(", ")}</td>
                  <td className="p-2">{m.batch}</td>
                  <Num>{m.debitCentimes > 0n ? formatMoney(m.debitCentimes) : ""}</Num>
                  <Num>{m.creditCentimes > 0n ? formatMoney(m.creditCentimes) : ""}</Num>
                  {/* FN10: an expense's receipt; other movements have none to attach */}
                  <td className="p-2">
                    {m.receipt ? (
                      <a href={`/api/files/${m.receipt}`} aria-label={t("Treasury.receiptViewOf", { line: `${formatDay(m.day as FarmDay, lang)} · ${m.label}` })} className="underline underline-offset-4">{t("Treasury.receiptView")}</a>
                    ) : m.receipt === null ? (
                      <span className="text-brick-fg">{t("Treasury.receiptMissing")}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
