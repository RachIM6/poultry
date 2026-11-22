import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BackLink } from "@/components/app-nav";
import { card, done, table, warn } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { formatCount, formatDay, formatKg, formatMoney } from "@/lib/format";
import { addFarmDays } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { closePreview, type CloseBatchView, type CloseStockView } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { CloseForm, ValuesForm, YearForm } from "./form";

// SPEC-finance FCX4 (T103), FCX2: "Préparer la clôture", online like /books. Each kind's year-end entry, OD on the
// fiscal year's last day, as the run would post it; the owner posts it, the manager and the accountant read it.
// FCX6 (T104): whether the year is closed, for everyone who reads it; the owner closes or reopens it.
// FC5 (T108): the stock lines the "stock" entry values, where the owner types a lower current value until the run posts.
// FC4 (T109): the batches the "batch" entry values, the same way; the run refuses while one has no current value.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default function ClosingPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <header className="px-4 pt-4">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <CloseView searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function CloseView({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const result = await closePreview(ctx.value, typeof search.year === "string" && /^\d{4}$/.test(search.year) ? Number(search.year) : null);
  if (!result.ok) return <p>{t("Expenses.forbidden")}</p>;
  const { year, day, books, locked, closedOn, frozen, entries, stocks, batches } = result.value;
  const todo = entries.some((e) => e.action === "post" || e.action === "repost" || e.action === "reverse");
  const money = (c: bigint) => (c === 0n ? "" : formatMoney(c));
  const owner = can(ctx.value, "finance.manage") && !frozen; // the manager and the accountant read (FCX1)
  const quantity = (l: CloseStockView) => (l.unit === "kg" ? formatKg(l.quantity) : `${formatCount(l.quantity)} ${t(`Stock.units.${l.unit}`)}`);
  const label = (l: CloseStockView) => `${t(`Stock.kinds.${l.kind}`)} · ${l.name}${l.lot ? ` · ${l.lot}` : ""}`;
  const typed = (c: bigint | null) => (c === null ? "" : `${c / 100n},${String(c % 100n).padStart(2, "0")}`);
  const stockTable = stocks.length > 0 && (
    <ValuesForm year={year} write={owner}>
      <p className="text-sm text-ink-2">{t("Close.stocksHint")}</p>
      {frozen && <p className="text-sm font-semibold">{t("Close.valuesFrozen")}</p>}
      <div className="relative overflow-x-auto">
        <table className={table} aria-label={t("Close.stocks")}>
          <thead>
            <tr>
              <th className="p-2 text-start">{t("Count.item")}</th>
              <th className="p-2 text-end">{t("Close.quantity")}</th>
              <th className="p-2 text-end">{t("Close.atCost")}</th>
              <th className="p-2 text-end">{t("Close.currentValue")}</th>
              <th className="p-2 text-end">{t("Close.provision")}</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="p-2">{label(l)}<span className="block text-sm text-ink-2">{l.farm}</span></td>
                <td dir="ltr" className="p-2 text-end tabular-nums whitespace-nowrap">{quantity(l)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums whitespace-nowrap">{l.cost === null ? <span dir="auto">{t("Close.notValued")}</span> : formatMoney(l.cost)}</td>
                <td className="p-2 text-end tabular-nums whitespace-nowrap">
                  {owner && l.cost !== null ? (
                    <input key={`${l.id}:${l.current}`} name={`value:${l.id}`} defaultValue={typed(l.current)} inputMode="decimal" dir="ltr" aria-label={t("Close.currentValueOf", { line: label(l) })} className="w-32 rounded-lg border border-line bg-card px-2 py-1 text-end" />
                  ) : (
                    <bdi dir="ltr">{l.current === null ? "" : formatMoney(l.current)}</bdi>
                  )}
                </td>
                <td dir="ltr" className="p-2 text-end tabular-nums whitespace-nowrap">{money(l.provision)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ValuesForm>
  );
  // FC4 (T109): the meat batches open on the last day, at cost by head, against the suggested or typed current value.
  const batchLabel = (b: CloseBatchView) => `${b.houseName} · ${t(`Types.${b.species}`)}`;
  const batchTable = batches.length > 0 && (
    <ValuesForm year={year} write={owner && batches.some((b) => b.valued)}>
      <p className="text-sm text-ink-2">{t("Close.batchesHint")}</p>
      {frozen && <p className="text-sm font-semibold">{t("Close.valuesFrozen")}</p>}
      <div className="relative overflow-x-auto">
        <table className={table} aria-label={t("Close.batches")}>
          <thead>
            <tr>
              <th className="p-2 text-start">{t("Count.batches")}</th>
              <th className="p-2 text-end">{t("Close.birds")}</th>
              <th className="p-2 text-end">{t("Close.atCost")}</th>
              <th className="p-2 text-end">{t("Close.currentValue")}</th>
              <th className="p-2 text-end">{t("Close.provision")}</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="p-2">{batchLabel(b)}<span className="block text-sm text-ink-2">{b.farm}</span></td>
                <td dir="ltr" className="p-2 text-end tabular-nums whitespace-nowrap">{formatCount(b.onHand)}</td>
                <td dir="ltr" className="p-2 text-end tabular-nums whitespace-nowrap">{b.valued ? formatMoney(b.cost) : <span dir="auto">{t("Close.notValuedFq7")}</span>}</td>
                <td className="p-2 text-end tabular-nums whitespace-nowrap">
                  {owner && b.valued ? (
                    <input key={`${b.id}:${b.typed}`} name={`value:${b.id}`} defaultValue={typed(b.typed)} placeholder={typed(b.suggested)} inputMode="decimal" dir="ltr" aria-label={t("Close.currentValueOf", { line: batchLabel(b) })} className="w-32 rounded-lg border border-line bg-card px-2 py-1 text-end" />
                  ) : (
                    <bdi dir="ltr">{b.current === null ? "" : formatMoney(b.current)}</bdi>
                  )}
                  {b.missing && <span className="block text-sm whitespace-normal text-alert-fg">{t("Close.valueRequired")}</span>}
                </td>
                <td dir="ltr" className="p-2 text-end tabular-nums whitespace-nowrap">{money(b.provision)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ValuesForm>
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Close.title")}</h1>
      <nav className="flex flex-wrap items-center gap-3" aria-label={t("Count.year")}>
        <Link href={{ pathname: "/closing", query: { year: year - 1 } }} className="inline-block underline underline-offset-4 rtl:-scale-x-100">←</Link>
        <span className="font-semibold" dir="ltr">{year}</span>
        <Link href={{ pathname: "/closing", query: { year: year + 1 } }} className="inline-block underline underline-offset-4 rtl:-scale-x-100">→</Link>
        <Link href={{ pathname: "/closing/count", query: { year } }} className="ms-auto underline underline-offset-4">{t("Count.open")}</Link>
      </nav>
      <p className="text-sm text-ink-2">{t("Close.hint", { day: formatDay(day, lang) })}</p>
      {books !== "ledger" && <p className={warn}>{t("Close.cashBook")}</p>}
      {closedOn && <p className={done}>{t("Close.closedOn", { day: formatDay(closedOn, lang) })}</p>}
      {locked && !closedOn && <p className={warn}>{t("Close.locked")}</p>}
      {entries.map((e) => (
        <section key={e.kind} aria-label={t(`Close.kinds.${e.kind}`)} className={card}>
          <h2 className="text-xl font-semibold">{t(`Close.kinds.${e.kind}`)}</h2>
          <p>{t(`Close.actions.${e.action}`)}</p>
          {e.lines.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className={table} aria-label={t("Close.entryOf", { kind: t(`Close.kinds.${e.kind}`) })}>
                <thead>
                  <tr>
                    <th className="p-2 text-start">{t("Books.account")}</th>
                    <th className="p-2 text-end">{t("Books.debit")}</th>
                    <th className="p-2 text-end">{t("Books.credit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="p-2"><bdi dir="ltr">{l.account}</bdi> {l.label}</td>
                      <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.debit)}</td>
                      <td dir="ltr" className="p-2 text-end tabular-nums">{money(l.credit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {e.kind === "stock" && stockTable}
          {e.kind === "batch" && batchTable}
        </section>
      ))}
      {books === "ledger" && !todo && <p>{t("Close.nothing")}</p>}
      {books === "ledger" && can(ctx.value, "finance.manage") && (
        <>
          <CloseForm year={year} disabled={locked} />
          <YearForm year={year} closed={closedOn !== null} hint={closedOn ? t("Close.reopenHint") : t("Close.closeYearHint", { next: formatDay(addFarmDays(day, 1), lang) })} />
        </>
      )}
    </>
  );
}
