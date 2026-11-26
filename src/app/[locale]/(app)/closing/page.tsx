import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Page, PeriodNav } from "@/components/page";
import { dataTable, empty } from "@/components/layout";
import { card, done, warn } from "@/components/ui";
import { Num } from "@/components/num";
import { redirect } from "@/i18n/navigation";
import { formatCount, formatDay, formatKg, formatMoney } from "@/lib/format";
import { typedCentimes } from "@/lib/kernel/money";
import { addFarmDays } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { closePreview, type CloseBatchView, type CloseHensView, type CloseStockView, type EggCostView } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { CloseForm, HensForm, OpenYearForm, UseSuggested, ValuesForm, YearForm } from "./form";
import { ClosingSteps } from "./steps";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Close", "Nav", "Offline", "Sync.refused", "errors"];

// SPEC-finance FCX4 (T103), FCX2: "Préparer la clôture", online like /books. Each kind's year-end entry, OD on the
// fiscal year's last day, as the run would post it; the owner posts it, the manager and the accountant read it.
// FCX6 (T104): whether the year is closed, for everyone who reads it; the owner closes or reopens it.
// FC5 (T108): the stock lines the "stock" entry values, where the owner types a lower current value until the run posts.
// FC4 (T109): the batches the "batch" entry values, the same way; the run refuses while one has no current value.
// FC5 (T113): each farm's eggs in the "stock" entry, at the value per egg the owner types; required before the run posts.
// FQ18: a suggested cost per egg next to it, with what it is based on; one tap copies it into the field, never by itself.
// FN3: until the previous year is closed, the owner opens this one from it as it stands, marked provisional for everyone.
// FC6 (T114, T115): the layer and pullet batches by the hens' method; the owner types each laying flock's life and cull
// value (classic) or the current value of a bird (simplified), required before the run posts.
// Seconds the host lets one call run (Vercel, docs/deploy-vercel-supabase.md), this page's server actions included:
// the close run posts a whole year's entries.
export const maxDuration = 300;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default function ClosingPage({ searchParams }: { searchParams: Search }) {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/more" />}>
        <CloseView searchParams={searchParams} />
      </Suspense>
    </ClientMessages>
  );
}

async function CloseView({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const result = await closePreview(ctx.value, typeof search.year === "string" && /^\d{4}$/.test(search.year) ? Number(search.year) : null);
  if (!result.ok) return <Page width="wide" back="/more"><p>{t("Close.forbidden")}</p></Page>;
  const { year, day, books, locked, closedOn, frozen, opening, entries, stocks, batches, eggs, hens } = result.value;
  const todo = entries.some((e) => e.action === "post" || e.action === "repost" || e.action === "reverse");
  const money = (c: bigint) => (c === 0n ? "" : formatMoney(c));
  const manage = can(ctx.value, "finance.manage");
  const owner = manage && !frozen; // the manager and the accountant read (FCX1)
  const typeable = (l: { missing: boolean }) => owner || (manage && l.missing); // after the run: a value still missing (FCX4)
  const quantity = (l: CloseStockView) => (l.unit === "kg" ? formatKg(l.quantity, true) : `${formatCount(l.quantity)} ${t(`Stock.units.${l.unit}`)}`);
  const label = (l: CloseStockView) => `${t(`Stock.kinds.${l.kind}`)} · ${l.name}${l.lot ? ` · ${l.lot}` : ""}`;
  const typed = (c: bigint | null) => (c === null ? "" : typedCentimes(c));
  // tasks/plan-ui-cleanup.md §2.1: the long explanations fold away under « Comment c'est calculé ».
  const how = (text: string, className = "") => (
    <details className={`text-sm text-ink-2 ${className}`}>
      <summary className="disclosure w-fit font-medium">{t("Close.howCalculated")}</summary>
      <p className="max-w-prose pb-2">{text}</p>
    </details>
  );
  const stockTable = stocks.length > 0 && (
    <ValuesForm year={year} write={owner}>
      {frozen && <p className="text-sm font-semibold">{t("Close.valuesFrozen")}</p>}
      <div className="relative overflow-x-auto">
        <table className={dataTable} aria-label={t("Close.stocks")}>
          <thead>
            <tr>
              <th>{t("Count.item")}</th>
              <th className="text-end!">{t("Close.quantity")}</th>
              <th className="text-end!">{t("Close.atCost")}</th>
              <th className="text-end!">{t("Close.currentValue")}</th>
              <th className="text-end!">{t("Close.provision")}</th>
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
                    <input key={`${l.id}:${l.current}`} name={`value:${l.id}`} defaultValue={typed(l.current)} inputMode="decimal" dir="ltr" aria-label={t("Close.currentValueOf", { line: label(l) })} className="w-32 min-h-11 rounded-lg border border-muted bg-card px-2 text-end lg:min-h-9" />
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
  // FC4 (T109): the meat batches open on the last day, at cost by head, against the suggested or typed current value;
  // FQ19: the cost engaged split into direct costs, depreciation and indirect production costs.
  const batchLabel = (b: CloseBatchView) => `${b.houseName} · ${t(`Types.${b.species}`)}`;
  const batchTable = batches.length > 0 && (
    <ValuesForm year={year} write={batches.some((b) => b.valued && typeable(b))}>
      {frozen && <p className="text-sm font-semibold">{t("Close.valuesFrozen")}</p>}
      <div className="relative overflow-x-auto">
        <table className={dataTable} aria-label={t("Close.batches")}>
          <thead>
            <tr>
              <th>{t("Count.batches")}</th>
              <th className="text-end!">{t("Close.birds")}</th>
              <th className="text-end!">{t("Close.atCost")}</th>
              <th className="text-end!">{t("Close.currentValue")}</th>
              <th className="text-end!">{t("Close.provision")}</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="p-2">
                  {batchLabel(b)}
                  <span className="block text-sm text-ink-2">{b.farm}</span>
                  {b.valued && (
                    <span className="block text-sm text-ink-2">
                      {t("Close.engaged", { total: formatMoney(b.engaged), direct: formatMoney(b.costs.direct), depreciation: formatMoney(b.costs.depreciation), indirect: formatMoney(b.costs.indirect) })}
                    </span>
                  )}
                </td>
                <Num className="whitespace-nowrap">{formatCount(b.onHand)}</Num>
                <Num className="whitespace-nowrap">{b.valued ? formatMoney(b.cost) : <span dir="auto">{t("Close.notValuedFq7")}</span>}</Num>
                <td className="p-2 text-end tabular-nums whitespace-nowrap">
                  {b.valued && typeable(b) ? (
                    <input key={`${b.id}:${b.typed}`} name={`value:${b.id}`} defaultValue={typed(b.typed)} placeholder={typed(b.suggested)} inputMode="decimal" dir="ltr" aria-label={t("Close.currentValueOf", { line: batchLabel(b) })} className="w-32 min-h-11 rounded-lg border border-muted bg-card px-2 text-end lg:min-h-9" />
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
  // The suggestion (FQ18) says what it is based on, or why there is none.
  const suggestion = (s: EggCostView) =>
    s.perEgg === null ? (
      <span className="block text-sm text-ink-2">{t(`Close.noSuggestion.${s.reason}`)}</span>
    ) : (
      <>
        <span className="block text-sm text-ink-2">
          {t("Close.suggestedCost", { perEgg: formatMoney(s.perEgg), total: formatMoney(s.total), eggs: formatCount(s.eggs), from: formatDay(s.from, lang), to: formatDay(s.to, lang) })}
        </span>
        <span className="block text-sm text-ink-2">{t("Close.suggestedParts", { direct: formatMoney(s.direct), depreciation: formatMoney(s.depreciation), indirect: formatMoney(s.indirect), hens: formatMoney(s.hens) })}</span>
        {s.hensPending && <span className="block text-sm text-ink-2">{t("Close.suggestedHensPending")}</span>}
      </>
    );
  const eggTable = eggs.length > 0 && (
    <ValuesForm year={year} write={eggs.some((e) => e.posted && typeable(e))}>
      {how(t("Close.eggsHint"))}
      {frozen && <p className="text-sm font-semibold">{t("Close.valuesFrozen")}</p>}
      <div className="relative overflow-x-auto">
        <table className={dataTable} aria-label={t("Close.eggs")}>
          <thead>
            <tr>
              <th>{t("Close.farm")}</th>
              <th className="text-end!">{t("Close.eggCount")}</th>
              <th className="text-end!">{t("Close.perEgg")}</th>
              <th className="text-end!">{t("Close.eggsValue")}</th>
            </tr>
          </thead>
          <tbody>
            {eggs.map((e) => (
              <tr key={e.farmId} className="border-t border-line">
                <td className="p-2">
                  {e.farm}
                  {e.suggestion && suggestion(e.suggestion)}
                </td>
                <Num className="whitespace-nowrap">{formatCount(e.quantity)}</Num>
                <td className="p-2 text-end tabular-nums whitespace-nowrap">
                  {!e.posted ? (
                    <span className="whitespace-normal">{t("Close.eggsNotPosted")}</span>
                  ) : typeable(e) ? (
                    <>
                      <input key={`${e.farmId}:${e.perEgg}`} name={`value:${e.farmId}`} defaultValue={typed(e.perEgg)} inputMode="decimal" dir="ltr" aria-label={t("Close.perEggOf", { farm: e.farm })} className="w-24 min-h-11 rounded-lg border border-muted bg-card px-2 text-end lg:min-h-9" />
                      {e.suggestion?.perEgg != null && <UseSuggested name={`value:${e.farmId}`} value={typed(e.suggestion.perEgg)} label={t("Close.useSuggestedOf", { farm: e.farm })} />}
                    </>
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
    <input key={`${name}:${value}`} name={name} defaultValue={value} inputMode="decimal" dir="ltr" aria-label={label} className="w-28 min-h-11 rounded-lg border border-muted bg-card px-2 text-end lg:min-h-9" />
  );
  const num = (text: string) => <Num className="whitespace-nowrap">{text}</Num>;
  const hensRows = (cols: string[], cells: (h: Hen) => React.ReactNode) => (
    <div className="relative overflow-x-auto">
      <table className={dataTable} aria-label={t("Close.hens")}>
        <thead>
          <tr>
            <th>{t("Count.batches")}</th>
            {cols.map((c) => <th key={c} className="text-end!">{t(c)}</th>)}
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

  // The status of an entry, coloured by what the run will do with it.
  const BADGE = { post: "bg-chick-soft text-chick-fg", repost: "bg-chick-soft text-chick-fg", reverse: "bg-chick-soft text-chick-fg", unchanged: "bg-olive-soft text-olive", none: "bg-shell text-ink-2" } as const;
  // An entry with the lines it values takes the whole width from lg; an entry alone shares a row; nothing to pass, one line.
  const full = (kind: string) => ["stock", "batch", "hens"].includes(kind) && (kind !== "stock" || stocks.length + eggs.length > 0) && (kind !== "batch" || batches.length > 0) && (kind !== "hens" || hens.lines.length > 0);
  // Its « Comment c'est calculé », on the heading's row.
  const hint = (e: (typeof entries)[number]) =>
    e.kind === "stock" && stocks.length > 0 ? "Close.stocksHint"
    : e.kind === "batch" && batches.length > 0 ? "Close.batchesHint"
    : e.kind === "hens" && hens.lines.length > 0 && hens.method === "classic" ? "Close.hensClassicHint"
    : e.kind === "hens" && hens.lines.length > 0 && hens.method === "simplified" ? "Close.hensSimplifiedHint"
    : e.kind === "interest" && e.lines.length > 0 ? "Close.interestHint"
    : null;
  const section = (e: (typeof entries)[number]) => {
    const kind = t(`Close.kinds.${e.kind}`);
    const badge = <p className={`rounded-lg px-2 py-0.5 text-sm ${BADGE[e.action]}`}>{t(`Close.actions.${e.action}`)}</p>;
    const key = hint(e);
    if (!(e.lines.length > 0 || full(e.kind)))
      return (
        <section key={e.kind} aria-label={kind} className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{kind}</h2>
          {badge}
        </section>
      );
    return (
      <section key={e.kind} aria-label={kind} className={`${card} ${full(e.kind) ? "lg:col-span-full" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">{kind}</h2>
          {badge}
          {key && how(t(key), "lg:ms-auto open:basis-full open:ms-0")}
        </div>
        {/* From lg, an entry beside the lines it values. */}
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start lg:gap-x-6 lg:has-[>:only-child]:grid-cols-1">
        {e.lines.length > 0 && (
          <div className="relative overflow-x-auto">
            <table className={dataTable} aria-label={t("Close.entryOf", { kind })}>
              <thead>
                <tr>
                  <th>{t("Books.account")}</th>
                  <th className="text-end!">{t("Books.debit")}</th>
                  <th className="text-end!">{t("Books.credit")}</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l, i) => (
                  <tr key={i}>
                    <td><bdi dir="ltr">{l.account}</bdi> {l.label}</td>
                    <Num>{money(l.debit)}</Num>
                    <Num>{money(l.credit)}</Num>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {full(e.kind) && (
          <div className="flex flex-col gap-3">
            {e.kind === "stock" && stockTable}
            {e.kind === "stock" && eggTable}
            {e.kind === "batch" && batchTable}
            {e.kind === "hens" && hensTable}
          </div>
        )}
        </div>
      </section>
    );
  };
  const blank = entries.filter((e) => !(e.lines.length > 0 || full(e.kind)));

  return (
    <Page
      width="wide"
      back="/more"
      title={t("Close.title")}
      subtitle={books === "ledger" && <span className="block max-w-3xl">{t("Close.hint", { day: formatDay(day, lang) })}</span>}
      nav={
        <ClosingSteps
          current="entries"
          year={year}
          period={
            <PeriodNav
              label={t("Count.year")}
              period={<span dir="ltr">{year}</span>}
              prev={{ href: { pathname: "/closing", query: { year: year - 1 } }, label: t("Count.previousYear") }}
              next={{ href: { pathname: "/closing", query: { year: year + 1 } }, label: t("Count.nextYear") }}
            />
          }
        />
      }
    >
      {/* Not an error: a cash-basis entity has no balance sheet, so nothing to close here (§2.8). */}
      {books !== "ledger" && <p className={empty}>{t("Close.cashBook")}</p>}
      {closedOn && <p className={done}>{t("Close.closedOn", { day: formatDay(closedOn, lang) })}</p>}
      {locked && !closedOn && <p className={warn}>{t("Close.locked")}</p>}
      {opening === "provisional" && <p className={warn}>{t("Close.openingProvisional", { previous: year - 1 })}</p>}
      {opening && manage && (
        <OpenYearForm
          year={year}
          label={opening === "due" ? t("Close.openYear", { year }) : t("Close.refreshOpening", { previous: year - 1 })}
          hint={t("Close.openYearHint", { previous: year - 1 })}
        />
      )}
      {blank.length > 0 && <div className="flex flex-wrap gap-x-8 gap-y-2 px-1">{blank.map(section)}</div>}
      {entries.length > blank.length && (
        // The entries alone first, side by side from lg, then those whose lines the owner values.
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start">
          {entries.filter((e) => !blank.includes(e) && !full(e.kind)).map(section)}
          {entries.filter((e) => full(e.kind)).map(section)}
        </div>
      )}
      {books === "ledger" && (
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start">
          <div className="flex flex-col gap-3">
            {!todo && <p>{t("Close.nothing")}</p>}
            {manage && <CloseForm year={year} disabled={locked} />}
          </div>
          {/* §5 batch 4: closing the year is a step of its own, after the entries, with what it needs first. */}
          {manage && (
            <section aria-labelledby="year-close" className={card}>
              <h2 id="year-close" className="text-lg font-semibold">{t(closedOn ? "Close.reopen" : "Close.closeYear")}</h2>
              {todo && !closedOn && <p className="text-sm font-medium">{t("Close.closeYearFirst")}</p>}
              <YearForm year={year} closed={closedOn !== null} hint={closedOn ? t("Close.reopenHint") : t("Close.closeYearHint", { next: formatDay(addFarmDays(day, 1), lang) })} />
            </section>
          )}
        </div>
      )}
    </Page>
  );
}
