import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { treasuryOverview } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

// SPEC-finance FN10: an online page for the owner and the manager (the web side of SPEC's split): each bank account's
// and cash box's balance, and this month's movements on 5141 / 5161. Server-rendered from the ledger, never cached.
export default function TreasuryPage() {
  return (
    <>
      <header className="flex justify-between gap-4 p-4">
        <Link href="/dashboard" className="py-2 underline underline-offset-4">←</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Treasury />
        </Suspense>
      </main>
    </>
  );
}

async function Treasury() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const month = farmDayOf(new Date()).slice(0, 7);
  const overview = await treasuryOverview(ctx.value, month);
  if (!overview.ok) return <p>{t("Expenses.forbidden")}</p>;
  const { accounts, movements } = overview.value;
  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? t(id === null ? "Treasury.untagged" : "Treasury.unknown");
  const total = accounts.reduce((s, a) => s + a.balanceCentimes, 0n);
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
      <h2 className="text-[17px] font-semibold text-ink-2">{t("Treasury.movements")}</h2>
      {movements.length === 0 ? (
        <p>{t("Treasury.none")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start">
              <th className="p-2 text-start">{t("Treasury.day")}</th>
              <th className="p-2 text-start">{t("Treasury.journal")}</th>
              <th className="p-2 text-start">{t("Treasury.label")}</th>
              <th className="p-2 text-start">{t("Treasury.account")}</th>
              <th className="p-2 text-end">{t("Treasury.in")}</th>
              <th className="p-2 text-end">{t("Treasury.out")}</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m, i) => (
              <tr key={i} className="border-t border-line">
                <td className="p-2">{formatDay(m.day as FarmDay, lang)}</td>
                <td className="p-2">{m.journal}</td>
                <td className="p-2">{m.label}</td>
                <td className="p-2">{nameOf(m.treasuryId)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{m.debitCentimes > 0n ? formatMoney(m.debitCentimes) : ""}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums">{m.creditCentimes > 0n ? formatMoney(m.creditCentimes) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
