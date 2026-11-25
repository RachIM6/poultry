import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BackLink } from "@/components/app-nav";
import { Link, redirect } from "@/i18n/navigation";
import { formatCount, formatDay, formatKg, formatKgValue } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { yearEndCount, type CountBatchLine, type CountEggsLine, type CountLine, type CountStockLine } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { CountForm, PrintButton } from "./form";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Count.print", "Count.save", "Count.saved", "Nav", "Offline", "Sync.refused", "errors"];

// SPEC-finance FC3 (T107): the year-end count sheet, per farm, printable on A4 with an empty "Compté" column and no
// amount; then the quantities counted, entered online by the owner or a manager, and the gap per line. Online, like /books.
// T113: each farm's egg stock (SPEC-m3 E2), one line, in eggs.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default function CountPage({ searchParams }: { searchParams: Search }) {
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="px-4 pt-4 print:hidden">
        <BackLink href="/more" />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 print:max-w-none print:p-0">
        <Suspense>
          <CountView searchParams={searchParams} />
        </Suspense>
      </main>
    </ClientMessages>
  );
}

// As the register's tables: ruled cells that print black (src/components/register-document.tsx).
const sheet =
  "w-full border-collapse text-sm [&_td]:border [&_td]:border-line [&_td]:p-2 [&_th]:border [&_th]:border-line [&_th]:bg-shell [&_th]:p-2 [&_th]:text-start [&_th]:font-semibold print:[&_td]:border-black print:[&_th]:border-black";
const box = "min-h-11 w-28 rounded-lg border border-muted bg-card px-2 text-end";

async function CountView({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const result = await yearEndCount(ctx.value, typeof search.year === "string" && /^\d{4}$/.test(search.year) ? Number(search.year) : null);
  if (!result.ok) return <p>{t("Count.forbidden")}</p>;
  const { year, day, frozen, farms } = result.value;
  const write = can(ctx.value, "finance.record") && !frozen; // the accountant reads (FCX1); frozen once the close posted (FCX4)

  const kg = (l: CountLine) => l.kind === "stock" && l.unit === "kg";
  const unit = (l: CountLine) => (l.kind === "batch" ? t("Count.birdUnit") : l.kind === "eggs" ? t("Count.eggUnit") : t(`Stock.units.${l.unit}`));
  const quantity = (n: number, l: CountLine) => <bdi>{kg(l) ? formatKg(n) : `${formatCount(n)} ${unit(l)}`}</bdi>; // as the stock screen; "kg" stays after its number in Arabic
  // The sign stays with its number in Arabic too.
  const gap = (l: CountLine) =>
    l.gap !== null && (
      <>
        <bdi dir="ltr">{l.gap > 0 ? "+" : l.gap < 0 ? "−" : ""}{kg(l) ? formatKgValue(Math.abs(l.gap)) : formatCount(Math.abs(l.gap))}</bdi> {kg(l) ? "kg" : unit(l)}
      </>
    );
  const typed = (l: CountLine) => (l.counted === null ? "" : kg(l) ? String(l.counted / 1000) : String(l.counted));
  const label = (l: CountLine) => (l.kind === "batch" ? `${l.houseName} · ${t(`Types.${l.species}`)}` : l.kind === "eggs" ? t("Count.eggStock") : `${l.name}${l.lot ? ` · ${l.lot}` : ""}`);
  const fix = { batch: "Count.fixDay", stock: "Count.fixStock", eggs: "Count.fixEggs" } as const;

  // The "Compté" cell: empty on paper; online, the owner's or a manager's field, or what was counted for the accountant.
  const counted = (l: CountLine) => (
    <td className="text-end print:h-10 print:w-32">
      {write ? (
        <input key={`${l.id}:${l.counted}`} name={`count:${l.id}`} defaultValue={typed(l)} inputMode="decimal" dir="ltr" aria-label={t("Count.countedOf", { line: label(l) })} className={`${box} print:hidden`} />
      ) : (
        <span className="print:hidden">{l.counted === null ? "" : quantity(l.counted, l)}</span>
      )}
    </td>
  );
  const after = (l: CountLine) => (
    <>
      <td className="text-end tabular-nums print:hidden">{gap(l)}</td>
      <td className="print:hidden">
        {write && l.gap !== null && l.gap !== 0 && (
          <Link href={l.kind === "batch" ? `/batches#${l.id}` : l.kind === "eggs" ? "/eggs" : "/stock"} className="underline underline-offset-4">{t(fix[l.kind])}</Link>
        )}
      </td>
    </>
  );
  const head = (cells: string[]) => (
    <thead>
      <tr>
        {cells.map((c) => <th key={c}>{t(c)}</th>)}
        <th className="text-end! print:w-32">{t("Count.counted")}</th>
        <th className="text-end! print:hidden">{t("Count.gap")}</th>
        <th className="print:hidden"><span className="sr-only">{t("Count.fix")}</span></th>
      </tr>
    </thead>
  );

  return (
    <>
      <h1 className="text-2xl font-semibold print:hidden">{t("Count.title")}</h1>
      <nav className="flex flex-wrap items-center gap-3 print:hidden" aria-label={t("Count.year")}>
        <Link href={{ pathname: "/closing/count", query: { year: year - 1 } }} aria-label={t("Count.previousYear")} className="inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4 rtl:-scale-x-100">←</Link>
        <span className="font-semibold" dir="ltr">{year}</span>
        <Link href={{ pathname: "/closing/count", query: { year: year + 1 } }} aria-label={t("Count.nextYear")} className="inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4 rtl:-scale-x-100">→</Link>
        {farms.length > 0 && <span className="ms-auto"><PrintButton /></span>}
      </nav>
      <p className="text-sm text-ink-2 print:hidden">{t("Count.hint")}</p>
      {frozen && <p className="text-sm font-semibold print:hidden">{t("Count.frozen")}</p>}
      {farms.length === 0 ? (
        <p>{t("Count.none")}</p>
      ) : (
        <CountForm year={year} write={write}>
          {farms.map((f, i) => {
            const batches = f.lines.filter((l): l is CountBatchLine => l.kind === "batch");
            const stock = f.lines.filter((l): l is CountStockLine => l.kind === "stock");
            const eggs = f.lines.filter((l): l is CountEggsLine => l.kind === "eggs");
            return (
              <section key={f.id} aria-label={f.name} className={`flex flex-col gap-4 ${i > 0 ? "print:break-before-page" : ""}`}>
                <h2 className="text-xl font-semibold">{t("Count.sheet", { farm: f.name, day: formatDay(day, lang) })}</h2>
                {batches.length > 0 && (
                  <div className="relative overflow-x-auto">
                    <table className={sheet} aria-label={t("Count.batches")}>
                      <caption className="pb-1 text-start font-semibold">{t("Count.batches")}</caption>
                      {head(["Count.house", "Count.type", "Count.book"])}
                      <tbody>
                        {batches.map((l) => (
                          <tr key={l.id} className="break-inside-avoid">
                            <td>{l.houseName}</td>
                            <td>{t(`Types.${l.species}`)}</td>
                            <td className="tabular-nums">{quantity(l.book, l)}</td>
                            {counted(l)}
                            {after(l)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {stock.length > 0 && (
                  <div className="relative overflow-x-auto">
                    <table className={sheet} aria-label={t("Count.stock")}>
                      <caption className="pb-1 text-start font-semibold">{t("Count.stock")}</caption>
                      {head(["Count.item", "Count.lot", "Count.expiresOn", "Count.book"])}
                      <tbody>
                        {stock.map((l) => (
                          <tr key={l.id} className="break-inside-avoid">
                            <td>{t(`Stock.kinds.${l.itemKind}`)} · {l.name}</td>
                            <td className="whitespace-nowrap">{l.lot ?? ""}</td>
                            <td>
                              {l.expiresOn ? formatDay(l.expiresOn as FarmDay, lang) : ""}
                              {l.expired && <strong className="ms-2">{t("Count.expired")}</strong>}
                            </td>
                            <td className="tabular-nums">{quantity(l.book, l)}</td>
                            {counted(l)}
                            {after(l)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {eggs.length > 0 && (
                  <div className="relative overflow-x-auto">
                    <table className={sheet} aria-label={t("Count.eggs")}>
                      <caption className="pb-1 text-start font-semibold">{t("Count.eggs")}</caption>
                      {head(["Count.item", "Count.book"])}
                      <tbody>
                        {eggs.map((l) => (
                          <tr key={l.id} className="break-inside-avoid">
                            <td>{label(l)}</td>
                            <td className="tabular-nums">{quantity(l.book, l)}</td>
                            {counted(l)}
                            {after(l)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </CountForm>
      )}
    </>
  );
}
