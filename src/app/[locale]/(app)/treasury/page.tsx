import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { cashForecast, placementsToPay, treasuryOverview } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { BackLink } from "@/components/app-nav";
import { card, field, table } from "@/components/ui";
import { PlacementPayForm } from "./pay-form";

// SPEC-finance FN10: an online page for the owner and the manager (the web side of SPEC's split): each bank account's
// and cash box's balance, and this month's movements on 5141 / 5161. Server-rendered from the ledger, never cached.
export default function TreasuryPage() {
  return (
    <>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Treasury />
        </Suspense>
      </main>
    </>
  );
}

// The schedule's weeks: the year goes without saying ("20 nov."). Here, not in lib/format: /batches ships that file.
const dayMonth = (day: string, lang: string) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

async function Treasury() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const today = farmDayOf(new Date());
  const month = today.slice(0, 7);
  const [overview, forecast, toPay] = await Promise.all([treasuryOverview(ctx.value, month), cashForecast(ctx.value), placementsToPay(ctx.value)]);
  if (!overview.ok || !forecast.ok) return <p>{t("Expenses.forbidden")}</p>;
  const { accounts, movements } = overview.value;
  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? t(id === null ? "Treasury.untagged" : "Treasury.unknown");
  const total = accounts.reduce((s, a) => s + a.balanceCentimes, 0n);
  const label = (text: string, input: ReactNode) => (
    <label className="flex flex-col gap-1">
      {text}
      {input}
    </label>
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
        <li className="flex justify-between gap-4 p-3 font-semibold">
          <span>{t("Treasury.total")}</span>
          <span dir="ltr" className="tabular-nums">{formatMoney(total)}</span>
        </li>
      </ul>
      {/* F-Effects: the next weeks' cash, from today's cash and bank and what falls due */}
      <section className="flex flex-col gap-2" aria-labelledby="schedule">
        <h2 id="schedule" className="text-[17px] font-semibold text-ink-2">{t("Treasury.schedule")}</h2>
        <p className="text-sm text-ink-2">{t("Treasury.scheduleStart", { amount: formatMoney(forecast.value.startCentimes) })}</p>
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
                <td dir="ltr" className="p-2 text-end tabular-nums">{w.inCentimes === 0n ? "" : formatMoney(w.inCentimes)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{w.outCentimes === 0n ? "" : formatMoney(w.outCentimes)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{formatMoney(w.afterCentimes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm text-ink-2">{t("Treasury.scheduleNote")}</p>
      </section>
      {/* SPEC-finance §9 "Placement debts": the chicks or point-of-lay hens still owed, paid here (owner, manager) */}
      {toPay.ok && toPay.value.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="placements">
          <h2 id="placements" className="text-[17px] font-semibold text-ink-2">{t("Treasury.placements")}</h2>
          <p className="text-sm text-ink-2">{t("Treasury.placementsHint")}</p>
          {toPay.value.map((p) => (
            <article key={p.batchId} className={card}>
              <p className="font-semibold">{p.hatchery}</p>
              <p className="text-sm text-ink-2">{p.place} · {t("Treasury.placedOn", { day: formatDay(p.placedOn, lang) })} · <bdi dir="ltr">{p.account}</bdi></p>
              <p>{t("Treasury.owed", { amount: formatMoney(p.owed) })}</p>
              <details className="rounded-2xl border border-line p-3">
                <summary className="cursor-pointer">{t("Treasury.pay")}</summary>
                <div className="pt-3">
                  <PlacementPayForm submit={t("Assets.paySave")}>
                    <input type="hidden" name="batchId" value={p.batchId} />
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
                  </PlacementPayForm>
                </div>
              </details>
            </article>
          ))}
        </section>
      )}
      {/* SPEC-finance FC9: ticking each bank account's lines against its statements */}
      <Link href="/treasury/bank" className="py-2 underline underline-offset-4">{t("Bank.open")}</Link>
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
                  <td dir="ltr" className="p-2 text-end tabular-nums">{m.debitCentimes > 0n ? formatMoney(m.debitCentimes) : ""}</td>
                  <td dir="ltr" className="p-2 text-end tabular-nums">{m.creditCentimes > 0n ? formatMoney(m.creditCentimes) : ""}</td>
                  {/* FN10: an expense's receipt; other movements have none to attach */}
                  <td className="p-2">
                    {m.receipt ? (
                      <a href={`/api/files/${m.receipt}`} className="underline underline-offset-4">{t("Treasury.receiptView")}</a>
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
