import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Fragment, Suspense } from "react";
import { Page, PeriodNav } from "@/components/page";
import { empty as emptyBox } from "@/components/layout";
import { pickTab } from "@/components/paging";
import { Tabs } from "@/components/tabs";
import { ghost } from "@/components/ui";
import { EntityHeader } from "@/components/entity-header";
import { Num, Scroll } from "@/components/num";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { officialStatements, type OfficialStatements } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { PrintButton } from "../count/form";
import { ClosingSteps } from "../steps";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Count.print", "Count.save", "Count.saved", "Nav", "Offline", "Sync.refused", "errors"];

// SPEC-finance FC8 (T116): the bilan, the CPC and the ETIC tables the ledger fills, in the CGNC's simplified model (its
// PCA variant with the overlay), with N-1. "Projet" until the year close (FCX6). Printable (print CSS). Online, like /books.
// tasks/plan-ui-cleanup.md batch 4: one part per tab on screen (`?tab=`), every part on paper; a line with nothing in it
// waits behind « Afficher les lignes vides » (`?empty=1`) on screen and always prints, as the model has it.
type Search = Promise<{ [key: string]: string | string[] | undefined }>;
type Ledger = Extract<OfficialStatements, { books: "ledger" }>;
const TABS = ["actif", "passif", "cpc", "etic"] as const;

export default function StatementsPage({ searchParams }: { searchParams: Search }) {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="doc" back="/more" />}>
        <StatementsView searchParams={searchParams} />
      </Suspense>
    </ClientMessages>
  );
}

const sheet =
  "w-full border-collapse text-sm [&_td]:border [&_td]:border-line [&_td]:p-2 [&_th]:border [&_th]:border-line [&_th]:bg-shell [&_th]:p-2 [&_th]:text-start [&_th]:font-semibold print:[&_td]:border-black print:[&_th]:border-black";

async function StatementsView({ searchParams }: { searchParams: Search }) {
  const [ctx, lang, t, search] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations("Statements"), searchParams]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const result = await officialStatements(ctx.value, typeof search.year === "string" && /^\d{4}$/.test(search.year) ? Number(search.year) : null);
  if (!result.ok) return <Page width="doc" back="/more"><p>{t("forbidden")}</p></Page>;
  const s = result.value;
  const tab = pickTab(TABS, search.tab);
  const all = search.empty === "1";
  const at = (query: Record<string, string | number>) => ({ pathname: "/closing/statements", query });
  const keep = { tab, ...(all ? { empty: "1" } : {}) }; // the part and the empty lines shown, from year to year
  const nav = (
    <ClosingSteps
      current="statements"
      year={s.year}
      period={
        <PeriodNav
          label={t("year")}
          period={<span dir="ltr">{s.year}</span>}
          prev={{ href: at({ year: s.year - 1, ...keep }), label: t("previousYear") }}
          next={{ href: at({ year: s.year + 1, ...keep }), label: t("nextYear") }}
          end={s.books === "ledger" && <PrintButton />}
        />
      }
    />
  );
  if (s.books === "cash_book")
    return (
      <Page width="doc" back="/more" title={t("title")} nav={nav}>
        <p className={emptyBox}>{t("cashBook")}</p>
      </Page>
    );
  // The part on screen; the others hidden there and printed.
  const part = (...keys: (typeof TABS)[number][]) => (keys.includes(tab) ? "flex" : "hidden print:flex");
  // A line with nothing in it, this year or the previous: hidden on screen unless asked for, always printed.
  const blank = (...values: (bigint | undefined)[]) => (!all && values.every((v) => !v) ? "hidden print:table-row" : undefined);

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
                      {actif && <Num>{money(r.gross)}</Num>}
                      {actif && <Num>{money(r.contra)}</Num>}
                      <Num>{money(r.net)}</Num>
                      <Num>{money(prevNet(side, r.key))}</Num>
                    </tr>
                    {r.postes.map((x) => (
                      <tr key={x.key} className={actif ? blank(x.gross, x.contra, x.net, prevNet(side, x.key)) : blank(x.net, prevNet(side, x.key))}>
                        <td className="ps-6">{label(x)}</td>
                        {actif && <Num>{money(x.gross)}</Num>}
                        {actif && <Num>{money(x.contra)}</Num>}
                        <Num>{money(x.net)}</Num>
                        <Num>{money(prevNet(side, x.key))}</Num>
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
            <Num>{money(actif ? s.bilan.totalActif : s.bilan.totalPassif)}</Num>
            <Num>{money(prev ? (actif ? prev.bilan.totalActif : prev.bilan.totalPassif) : undefined)}</Num>
          </tr>
        </tbody>
      </table>
    );
  };

  const etic = (key: "s1" | "s1bis" | "s1_1" | "s1ter", rows: Ledger["etic"]["s1"] | undefined) =>
    rows && (
      <Scroll key={key} label={t(`etic.${key}`)}>
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
                {[x.start, x.increase, x.decrease, x.end].map((v, i) => <Num key={i}>{money(v)}</Num>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    );

  return (
    <Page width="doc" back="/more" title={t("title")} nav={nav}>
      {!s.closedOn && (
        <p aria-hidden className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center text-8xl font-bold text-ink-2/15 print:text-black/10 -rotate-30 select-none">
          {t("draft")}
        </p>
      )}
      <EntityHeader {...s.entity} />
      <p className="font-semibold">{s.closedOn ? t("closed", { day: day(s.closedOn) }) : t("draftCaption")}</p>
      <p className="text-sm text-ink-2">
        {t("period", { from: day(s.from), to: day(s.to) })} · {t(s.pca ? "modelPca" : "modelCgnc")}
      </p>
      {s.aboveLimit && <p className="text-sm font-semibold">{t("aboveLimit")}</p>}
      {s.bilan.unmapped.length + s.cpc.unmapped.length > 0 && (
        <p className="text-sm font-semibold">{t("unmapped", { accounts: [...s.bilan.unmapped, ...s.cpc.unmapped].join(", ") })}</p>
      )}

      <div className="flex flex-col gap-1 print:hidden lg:flex-row lg:items-center lg:gap-4">
        <div className="min-w-0 lg:flex-1">
          <Tabs
            label={t("tabs.label")}
            current={tab}
            tabs={TABS.map((key) => ({ key, label: t(`tabs.${key}`), href: at({ year: s.year, tab: key, ...(all ? { empty: "1" } : {}) }) }))}
          />
        </div>
        {tab !== "etic" && (
          <Link href={at({ year: s.year, tab, ...(all ? {} : { empty: "1" }) })} scroll={false} className={ghost}>{t(all ? "hideEmpty" : "showEmpty")}</Link>
        )}
      </div>

      <section aria-label={t("bilan")} className={`${part("actif", "passif")} flex-col gap-4`}>
        <h2 className="text-xl font-semibold">{t("bilan")}</h2>
        <div className={`${tab === "passif" ? "hidden print:block" : ""} relative overflow-x-auto`}>{bilanSide("actif")}</div>
        <div className={`${tab === "actif" ? "hidden print:block" : ""} relative overflow-x-auto`}>{bilanSide("passif")}</div>
      </section>

      <section aria-label={t("cpc")} className={`${part("cpc")} flex-col gap-4 print:break-before-page`}>
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
                    <tr key={x.key} className={blank(x.amount, prevCpc(x.key))}>
                      <td className="ps-6">{label(x)}</td>
                      <Num>{money(x.amount)}</Num>
                      <Num>{money(prevCpc(x.key))}</Num>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td>{label(g)}</td>
                    <Num>{money(g.total)}</Num>
                    <Num>{money(prevCpc(g.key))}</Num>
                  </tr>
                </Fragment>
              ))}
              {s.cpc.results.map((r) => (
                <tr key={r.key} className="bg-shell font-semibold">
                  <td>{label(r)}</td>
                  <Num>{formatMoney(r.amount)}</Num>
                  <Num>{money(prevCpc(r.key))}</Num>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label={t("etic.title")} className={`${part("etic")} flex-col gap-4 print:break-before-page`}>
        <h2 className="text-xl font-semibold">{t("etic.title")}</h2>
        <p className="text-sm text-ink-2">{t("etic.hint")}</p>
        {etic("s1", s.etic.s1)}
        {etic("s1bis", s.etic.s1bis)}
        {etic("s1_1", s.etic.s1_1)}
        {etic("s1ter", s.etic.s1ter)}
      </section>
    </Page>
  );
}
