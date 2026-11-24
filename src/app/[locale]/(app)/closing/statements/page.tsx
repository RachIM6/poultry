import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Fragment, Suspense } from "react";
import { BackLink } from "@/components/app-nav";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { officialStatements, type OfficialStatements } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { PrintButton } from "../count/form";

// SPEC-finance FC8 (T116): the bilan, the CPC and the ETIC tables the ledger fills, in the CGNC's simplified model (its
// PCA variant with the overlay), with N-1. "Projet" until the year close (FCX6). Printable (print CSS). Online, like /books.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;
type Ledger = Extract<OfficialStatements, { books: "ledger" }>;

export default function StatementsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <header className="px-4 pt-4 print:hidden">
        <BackLink href="/more" />
      </header>
      <main className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 print:max-w-none print:p-0">
        <Suspense>
          <StatementsView searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const sheet =
  "w-full border-collapse text-sm [&_td]:border [&_td]:border-line [&_td]:p-2 [&_th]:border [&_th]:border-line [&_th]:bg-shell [&_th]:p-2 [&_th]:text-start [&_th]:font-semibold print:[&_td]:border-black print:[&_th]:border-black";
const num = "text-end tabular-nums";

async function StatementsView({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations("Statements"), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const result = await officialStatements(ctx.value, typeof search.year === "string" && /^\d{4}$/.test(search.year) ? Number(search.year) : null);
  if (!result.ok) return <p>{t("forbidden")}</p>;
  const s = result.value;
  const nav = (
    <nav className="flex flex-wrap items-center gap-3 print:hidden" aria-label={t("year")}>
      <Link href={{ pathname: "/closing/statements", query: { year: s.year - 1 } }} className="inline-block underline underline-offset-4 rtl:-scale-x-100">←</Link>
      <span className="font-semibold" dir="ltr">{s.year}</span>
      <Link href={{ pathname: "/closing/statements", query: { year: s.year + 1 } }} className="inline-block underline underline-offset-4 rtl:-scale-x-100">→</Link>
      {s.books === "ledger" && <span className="ms-auto"><PrintButton /></span>}
    </nav>
  );
  if (s.books === "cash_book")
    return (
      <>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {nav}
        <p>{t("cashBook")}</p>
      </>
    );

  const label = (x: { fr: string; ar: string }) => (lang === "ar" ? x.ar : x.fr);
  const money = (c: bigint | undefined) => (c === undefined || c === 0n ? "" : formatMoney(c));
  const day = (d: string) => formatDay(d as FarmDay, lang);
  const prev = s.previous;
  const prevNet = (side: "actif" | "passif", key: string) =>
    prev?.bilan[side].flatMap((m) => m.rubriques.flatMap((r) => [r, ...r.postes])).find((x) => x.key === key)?.net;
  const prevCpc = (key: string) => prev?.cpc.groups.flatMap((g) => [{ key: g.key, amount: g.total }, ...g.lines]).find((x) => x.key === key)?.amount ?? prev?.cpc.results.find((r) => r.key === key)?.amount;

  const bilanSide = (side: "actif" | "passif") => {
    const actif = side === "actif";
    const masses = s.bilan[side];
    return (
      <table className={sheet}>
        <caption className="pb-1 text-start font-semibold">{t(side)}</caption>
        <thead>
          <tr>
            <th />
            {actif && <th className="text-end!">{t("gross")}</th>}
            {actif && <th className="text-end!">{t("contra")}</th>}
            <th className="text-end!">{t("net")}</th>
            <th className="text-end!">{t("previousNet")}</th>
          </tr>
        </thead>
        <tbody>
          {masses.map((m) => (
            <Fragment key={m.key}>
              <tr className="bg-shell font-semibold"><td colSpan={actif ? 5 : 3}>{label(m)}</td></tr>
              {m.rubriques
                .filter((r) => !r.optional || r.net !== 0n || r.gross !== 0n || (prevNet(side, r.key) ?? 0n) !== 0n)
                .map((r) => (
                  <Fragment key={r.key}>
                    <tr className="font-semibold">
                      <td>{label(r)}</td>
                      {actif && <td dir="ltr" className={num}>{money(r.gross)}</td>}
                      {actif && <td dir="ltr" className={num}>{money(r.contra)}</td>}
                      <td dir="ltr" className={num}>{money(r.net)}</td>
                      <td dir="ltr" className={num}>{money(prevNet(side, r.key))}</td>
                    </tr>
                    {r.postes.map((x) => (
                      <tr key={x.key}>
                        <td className="ps-6">{label(x)}</td>
                        {actif && <td dir="ltr" className={num}>{money(x.gross)}</td>}
                        {actif && <td dir="ltr" className={num}>{money(x.contra)}</td>}
                        <td dir="ltr" className={num}>{money(x.net)}</td>
                        <td dir="ltr" className={num}>{money(prevNet(side, x.key))}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
            </Fragment>
          ))}
          <tr className="border-t-2 font-semibold">
            <td>{t("total")}</td>
            {actif && <td />}
            {actif && <td />}
            <td dir="ltr" className={num}>{money(actif ? s.bilan.totalActif : s.bilan.totalPassif)}</td>
            <td dir="ltr" className={num}>{money(prev ? (actif ? prev.bilan.totalActif : prev.bilan.totalPassif) : undefined)}</td>
          </tr>
        </tbody>
      </table>
    );
  };

  const etic = (key: "s1" | "s1bis" | "s1_1" | "s1ter", rows: Ledger["etic"]["s1"] | undefined) =>
    rows && (
      <div key={key} className="relative overflow-x-auto">
        <table className={sheet}>
          <caption className="pb-1 text-start font-semibold">{t(`etic.${key}`)}</caption>
          <thead>
            <tr>
              <th />
              {(["start", "increase", "decrease", "end"] as const).map((c) => <th key={c} className="text-end!">{t(`etic.${key === "s1bis" ? "amort" : key === "s1ter" ? "stock" : "gross"}.${c}`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.key}>
                <td>{label(x)}</td>
                {[x.start, x.increase, x.decrease, x.end].map((v, i) => <td key={i} dir="ltr" className={num}>{money(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <>
      {!s.closedOn && (
        <p aria-hidden className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center text-8xl font-bold text-ink-2/15 print:text-black/10 -rotate-30 select-none">
          {t("draft")}
        </p>
      )}
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {nav}
      <p className="font-semibold">{s.closedOn ? t("closed", { day: day(s.closedOn) }) : t("draftCaption")}</p>
      <p className="text-sm text-ink-2">
        {t("period", { from: day(s.from), to: day(s.to) })} · {t(s.pca ? "modelPca" : "modelCgnc")}
      </p>
      {s.aboveLimit && <p className="text-sm font-semibold">{t("aboveLimit")}</p>}
      {s.bilan.unmapped.length + s.cpc.unmapped.length > 0 && (
        <p className="text-sm font-semibold">{t("unmapped", { accounts: [...s.bilan.unmapped, ...s.cpc.unmapped].join(", ") })}</p>
      )}

      <section aria-label={t("bilan")} className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("bilan")}</h2>
        <div className="relative overflow-x-auto">{bilanSide("actif")}</div>
        <div className="relative overflow-x-auto">{bilanSide("passif")}</div>
      </section>

      <section aria-label={t("cpc")} className="flex flex-col gap-4 print:break-before-page">
        <h2 className="text-xl font-semibold">{t("cpc")}</h2>
        <div className="relative overflow-x-auto">
          <table className={sheet}>
            <thead>
              <tr>
                <th />
                <th className="text-end!">{t("year")}</th>
                <th className="text-end!">{t("previous")}</th>
              </tr>
            </thead>
            <tbody>
              {s.cpc.groups.map((g) => (
                <Fragment key={g.key}>
                  {g.lines.map((x) => (
                    <tr key={x.key}>
                      <td className="ps-6">{label(x)}</td>
                      <td dir="ltr" className={num}>{money(x.amount)}</td>
                      <td dir="ltr" className={num}>{money(prevCpc(x.key))}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td>{label(g)}</td>
                    <td dir="ltr" className={num}>{money(g.total)}</td>
                    <td dir="ltr" className={num}>{money(prevCpc(g.key))}</td>
                  </tr>
                </Fragment>
              ))}
              {s.cpc.results.map((r) => (
                <tr key={r.key} className="bg-shell font-semibold">
                  <td>{label(r)}</td>
                  <td dir="ltr" className={num}>{formatMoney(r.amount)}</td>
                  <td dir="ltr" className={num}>{money(prevCpc(r.key))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label={t("etic.title")} className="flex flex-col gap-4 print:break-before-page">
        <h2 className="text-xl font-semibold">{t("etic.title")}</h2>
        <p className="text-sm text-ink-2">{t("etic.hint")}</p>
        {etic("s1", s.etic.s1)}
        {etic("s1bis", s.etic.s1bis)}
        {etic("s1_1", s.etic.s1_1)}
        {etic("s1ter", s.etic.s1ter)}
      </section>
    </>
  );
}
