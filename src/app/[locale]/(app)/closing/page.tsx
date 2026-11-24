import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BackLink } from "@/components/app-nav";
import { card, done, table, warn } from "@/components/ui";
import { Num } from "@/components/num";
import { Link, redirect } from "@/i18n/navigation";
import { formatCount, formatDay, formatKg, formatMoney } from "@/lib/format";
import { addFarmDays } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { closePreview, type CloseBatchView, type CloseHensView, type CloseStockView } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { CloseForm, HensForm, OpenYearForm, ValuesForm, YearForm } from "./form";

// SPEC-finance FCX4 (T103), FCX2: "Préparer la clôture", online like /books. Each kind's year-end entry, OD on the
// fiscal year's last day, as the run would post it; the owner posts it, the manager and the accountant read it.
// FCX6 (T104): whether the year is closed, for everyone who reads it; the owner closes or reopens it.
// FC5 (T108): the stock lines the "stock" entry values, where the owner types a lower current value until the run posts.
// FC4 (T109): the batches the "batch" entry values, the same way; the run refuses while one has no current value.
// FC5 (T113): each farm's eggs in the "stock" entry, at the value per egg the owner types; required before the run posts.
// FN3: until the previous year is closed, the owner opens this one from it as it stands, marked provisional for everyone.
// FC6 (T114, T115): the layer and pullet batches by the hens' method; the owner types each laying flock's life and cull
// value (classic) or the current value of a bird (simplified), required before the run posts.
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
  if (!result.ok) return <p>{t("Close.forbidden")}</p>;
  const { year, day, books, locked, closedOn, frozen, opening, entries, stocks, batches, eggs, hens } = result.value;
  const todo = entries.some((e) => e.action === "post" || e.action === "repost" || e.action === "reverse");
  const money = (c: bigint) => (c === 0n ? "" : formatMoney(c));
  const manage = can(ctx.value, "finance.manage");
  const owner = manage && !frozen; // the manager and the accountant read (FCX1)
  const typeable = (l: { missing: boolean }) => owner || (manage && l.missing); // after the run: a value still missing (FCX4)
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
                <Num className="whitespace-nowrap">{quantity(l)}</Num>
                <Num className="whitespace-nowrap">{l.cost === null ? <span dir="auto">{t("Close.notValued")}</span> : formatMoney(l.cost)}</Num>
                <td className="p-2 text-end tabular-nums whitespace-nowrap">
                  {owner && l.cost !== null ? (
                    <input key={`${l.id}:${l.current}`} name={`value:${l.id}`} defaultValue={typed(l.current)} inputMode="decimal" dir="ltr" aria-label={t("Close.currentValueOf", { line: label(l) })} className="w-32 min-h-11 rounded-lg border border-line bg-card px-2 text-end" />
                  ) : (
                    <bdi dir="ltr">{l.current === null ? "" : formatMoney(l.current)}</bdi>
                  )}
                </td>
                <Num className="whitespace-nowrap">{money(l.provision)}</Num>
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
    <ValuesForm year={year} write={batches.some((b) => b.valued && typeable(b))}>
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
                <Num className="whitespace-nowrap">{formatCount(b.onHand)}</Num>
                <Num className="whitespace-nowrap">{b.valued ? formatMoney(b.cost) : <span dir="auto">{t("Close.notValuedFq7")}</span>}</Num>
                <td className="p-2 text-end tabular-nums whitespace-nowrap">
                  {b.valued && typeable(b) ? (
                    <input key={`${b.id}:${b.typed}`} name={`value:${b.id}`} defaultValue={typed(b.typed)} placeholder={typed(b.suggested)} inputMode="decimal" dir="ltr" aria-label={t("Close.currentValueOf", { line: batchLabel(b) })} className="w-32 min-h-11 rounded-lg border border-line bg-card px-2 text-end" />
                  ) : (
                    <bdi dir="ltr">{b.current === null ? "" : formatMoney(b.current)}</bdi>
                  )}
                  {b.missing && <span className="block text-sm whitespace-normal text-alert-fg">{t("Close.valueRequired")}</span>}
                </td>
                <Num className="whitespace-nowrap">{money(b.provision)}</Num>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ValuesForm>
  );

  // FC5, FQ18 (T113): the eggs counted (else in the books) × the owner's value per egg; with the PCA off, nothing posts (FQ25).
  const eggTable = eggs.length > 0 && (
    <ValuesForm year={year} write={eggs.some((e) => e.posted && typeable(e))}>
      <p className="text-sm text-ink-2">{t("Close.eggsHint")}</p>
      {frozen && <p className="text-sm font-semibold">{t("Close.valuesFrozen")}</p>}
      <div className="relative overflow-x-auto">
        <table className={table} aria-label={t("Close.eggs")}>
          <thead>
            <tr>
              <th className="p-2 text-start">{t("Close.farm")}</th>
              <th className="p-2 text-end">{t("Close.eggCount")}</th>
              <th className="p-2 text-end">{t("Close.perEgg")}</th>
              <th className="p-2 text-end">{t("Close.eggsValue")}</th>
            </tr>
          </thead>
          <tbody>
            {eggs.map((e) => (
              <tr key={e.farmId} className="border-t border-line">
                <td className="p-2">{e.farm}</td>
                <Num className="whitespace-nowrap">{formatCount(e.quantity)}</Num>
                <td className="p-2 text-end tabular-nums whitespace-nowrap">
                  {!e.posted ? (
                    <span className="whitespace-normal">{t("Close.eggsNotPosted")}</span>
                  ) : typeable(e) ? (
                    <input key={`${e.farmId}:${e.perEgg}`} name={`value:${e.farmId}`} defaultValue={typed(e.perEgg)} inputMode="decimal" dir="ltr" aria-label={t("Close.perEggOf", { farm: e.farm })} className="w-24 min-h-11 rounded-lg border border-line bg-card px-2 text-end" />
                  ) : (
                    <bdi dir="ltr">{e.perEgg === null ? "" : formatMoney(e.perEgg)}</bdi>
                  )}
                  {e.missing && <span className="block text-sm whitespace-normal text-alert-fg">{t("Close.eggValueRequired")}</span>}
                </td>
                <Num className="whitespace-nowrap">{money(e.value)}</Num>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ValuesForm>
  );

  // FC6 (T114, T115): with the PCA off nothing is valued (FQ25).
  type Hen = CloseHensView["lines"][number];
  const flock = (h: Hen) => `${h.houseName} · ${t(`Types.${h.species}`)}`;
  const required = (h: Hen) => h.missing && <span className="block text-sm whitespace-normal text-alert-fg">{t("Close.valueRequired")}</span>;
  const field = (name: string, value: string, label: string) => (
    <input key={`${name}:${value}`} name={name} defaultValue={value} inputMode="decimal" dir="ltr" aria-label={label} className="w-28 min-h-11 rounded-lg border border-line bg-card px-2 text-end" />
  );
  const num = (text: string) => <Num className="whitespace-nowrap">{text}</Num>;
  const hensRows = (cols: string[], cells: (h: Hen) => React.ReactNode) => (
    <div className="relative overflow-x-auto">
      <table className={table} aria-label={t("Close.hens")}>
        <thead>
          <tr>
            <th className="p-2 text-start">{t("Count.batches")}</th>
            {cols.map((c) => <th key={c} className="p-2 text-end">{t(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {hens.lines.map((h) => (
            <tr key={h.id} className="border-t border-line">
              <td className="p-2">{flock(h)}<span className="block text-sm text-ink-2">{h.farm}</span></td>
              {num(formatCount(h.onHand))}
              {cells(h)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const hensTable =
    hens.lines.length === 0 ? null : hens.method === "classic" ? (
      <HensForm year={year} write={hens.lines.some((h) => h.species === "layer" && typeable(h))}>
        <p className="text-sm text-ink-2">{t("Close.hensClassicHint")}</p>
        {hensRows(["Close.birds", "Close.hensEntry", "Close.hensLife", "Close.hensCull", "Close.hensCharge"], (h) => (
          <>
            {num(money(h.entry))}
            <td className="p-2 text-end tabular-nums whitespace-nowrap">
              {h.species === "layer" && typeable(h) ? field(`life:${h.id}`, h.lifeMonths === null ? "" : String(h.lifeMonths), t("Close.hensLifeOf", { line: flock(h) })) : <bdi dir="ltr">{h.lifeMonths ?? ""}</bdi>}
            </td>
            <td className="p-2 text-end tabular-nums whitespace-nowrap">
              {h.species === "layer" && typeable(h) ? field(`cull:${h.id}`, typed(h.cullValue), t("Close.hensCullOf", { line: flock(h) })) : <bdi dir="ltr">{h.cullValue === null ? "" : formatMoney(h.cullValue)}</bdi>}
              {required(h)}
            </td>
            {num(money(h.charge))}
          </>
        ))}
      </HensForm>
    ) : hens.method === "simplified" ? (
      <ValuesForm year={year} write={hens.lines.some(typeable)}>
        <p className="text-sm text-ink-2">{t("Close.hensSimplifiedHint")}</p>
        {hensRows(["Close.birds", "Close.hensValue", "Close.hensPerBird", "Close.provision"], (h) => (
          <>
            {num(money(h.value))}
            <td className="p-2 text-end tabular-nums whitespace-nowrap">
              {typeable(h) ? field(`value:${h.id}`, typed(h.perBird), t("Close.hensPerBirdOf", { line: flock(h) })) : <bdi dir="ltr">{h.perBird === null ? "" : formatMoney(h.perBird)}</bdi>}
              {required(h)}
            </td>
            {num(money(h.provision))}
          </>
        ))}
      </ValuesForm>
    ) : (
      <p className="text-sm text-ink-2">{t("Close.hensNotValued")}</p>
    );

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Close.title")}</h1>
      <nav className="flex flex-wrap items-center gap-3" aria-label={t("Count.year")}>
        <Link href={{ pathname: "/closing", query: { year: year - 1 } }} aria-label={t("Count.previousYear")} className="inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4 rtl:-scale-x-100">←</Link>
        <span className="font-semibold" dir="ltr">{year}</span>
        <Link href={{ pathname: "/closing", query: { year: year + 1 } }} aria-label={t("Count.nextYear")} className="inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4 rtl:-scale-x-100">→</Link>
        <Link href={{ pathname: "/closing/count", query: { year } }} className="ms-auto underline underline-offset-4">{t("Count.open")}</Link>
      </nav>
      <p className="text-sm text-ink-2">{t("Close.hint", { day: formatDay(day, lang) })}</p>
      {books !== "ledger" && <p className={warn}>{t("Close.cashBook")}</p>}
      {closedOn && <p className={done}>{t("Close.closedOn", { day: formatDay(closedOn, lang) })}</p>}
      {locked && !closedOn && <p className={warn}>{t("Close.locked")}</p>}
      {opening === "provisional" && <p className={warn}>{t("Close.openingProvisional", { previous: year - 1 })}</p>}
      {opening && can(ctx.value, "finance.manage") && (
        <OpenYearForm
          year={year}
          label={opening === "due" ? t("Close.openYear", { year }) : t("Close.refreshOpening", { previous: year - 1 })}
          hint={t("Close.openYearHint", { previous: year - 1 })}
        />
      )}
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
                      <Num>{money(l.debit)}</Num>
                      <Num>{money(l.credit)}</Num>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {e.kind === "stock" && stockTable}
          {e.kind === "stock" && eggTable}
          {e.kind === "batch" && batchTable}
          {e.kind === "hens" && hensTable}
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
