"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { hasLocale, NextIntlClientProvider, useLocale, useTranslations, type AbstractIntlMessages } from "next-intl";
import { useEffect, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { Page } from "@/components/page";
import { REGISTER_ENTITIES, wholeRegister } from "@/components/register-access";
import { ghost, secondarySm, warn } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { dirOf, routing } from "@/i18n/routing";
import { formatCount, formatDay, formatKgValue } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import type { DisposalDto } from "@/modules/biosecurity/shared";
import type { DocumentDto } from "@/modules/documents/shared";
import { eggsIn, type EggCollectionDto } from "@/modules/eggs/shared";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto, DailyEntryDto, SoldBirdsDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto, VetVisitDto } from "@/modules/health/shared";
import type { StockItemDto } from "@/modules/inventory/shared";
import type { ReferenceData } from "@/modules/reference-data/schema";
import { buildRegister, type Register } from "@/modules/reporting/shared";
import type { BuyerDto, SaleDto } from "@/modules/sales/shared";
import { cachedReference, currentScope, localDb, scopeKey, type LocalRecord, type Scope } from "@/offline/db";
import { startSync } from "@/offline/sync";

// SPEC-m2-compliance RP2 on the static /register shell (in the app's shell): the "registre de suivi sanitaire" of one
// batch (/register#<batch id>/<fr|ar>), built on the phone so it prints offline, in French or Arabic. Print CSS only, no PDF
// library (D1). Sections in the order of arrêté n° 2126-05 art. 2, on paper and paginated (art. 8); what the app
// doesn't record is a blank line to fill by hand (CQ1).

const onHashChange = (notify: () => void) => (window.addEventListener("hashchange", notify), () => window.removeEventListener("hashchange", notify));
const useHash = () => useSyncExternalStore(onHashChange, () => decodeURIComponent(window.location.hash.slice(1)), () => "");

export function RegisterScreen({ documents }: { documents: Record<string, AbstractIntlMessages> }) {
  const t = useTranslations();
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return <Page width="docAside" back="/batches" />;
  if (scope === null) {
    return (
      <Page width="docAside" back="/batches" title={t("Register.title")}>
        <p>
          {t("Sync.signedOut")} <Link href="/login" className="underline underline-offset-4">{t("Sync.login")}</Link>
        </p>
      </Page>
    );
  }
  return <RegisterOf key={scopeKey(scope)} scope={scope} documents={documents} />;
}

// The register's parts, in its order: the contents on screen (each section's id).
const PARTS = ["cover", "supervision", "daily", "treatments", "vaccinations", "birdsOut", "disposals", "labReports", "visas", "annexes"] as const;

function RegisterOf({ scope: { userId, organizationId, role }, documents }: { scope: Scope; documents: Record<string, AbstractIntlMessages> }) {
  const t = useTranslations();
  const locale = useLocale();
  // #<batch id>/<language>: the document's language, French or Arabic whatever the app's (the batch's two links);
  // without one, the app's.
  const [batchId, asked = ""] = useHash().split("/");
  const language = hasLocale(routing.locales, asked) ? asked : locale;
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf(REGISTER_ENTITIES).toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const back = batchId ? `/batches#${batchId}` : "/batches"; // back to that batch
  if (!records || reference === undefined) return <Page width="docAside" back={back} />;

  const register = registerOf(batchId, records, reference?.data ?? null, language);
  if (!register) return <Page width="docAside" back={back} title={t("Register.title")}><p>{t("Register.notFound")}</p></Page>;
  const c = register.cover;
  return (
    <Page
      width="docAside"
      back={back}
      screenOnly
      title={c.house ? <>{t("Register.title")} · <bdi>{c.house}</bdi></> : t("Register.title")}
      subtitle={<><bdi>{c.farmName}</bdi> · {t("Register.batchOf", { date: formatDay(c.placedOn as FarmDay, locale) })}</>}
      actions={
        <>
          {/* The document's language, not the app's (that one is in the header's menu): each name in its own language. */}
          <nav aria-label={t("Register.language")} className="flex gap-1">
            {routing.locales.map((l) => (
              <a key={l} href={`#${batchId}/${l}`} lang={l} aria-current={l === language || undefined} className={`${ghost} underline-offset-4 aria-[current=true]:font-semibold aria-[current=true]:text-ink aria-[current=true]:underline`}>
                {t(`LocaleSwitcher.${l}`)}
              </a>
            ))}
          </nav>
          <button type="button" onClick={() => window.print()} className={secondarySm}>{t("Register.print")}</button>
        </>
      }
    >
      {/* A role whose phone lacks some of the register's records (the link isn't offered; a typed address still opens it) */}
      {!wholeRegister({ userId, organizationId, role }) && <p role="note" className={`${warn} print:hidden`}>{t("Register.incomplete")}</p>}
      <WithContents label={t("Inspection.contents")} parts={PARTS.map((id) => ({ id, label: t(`Register.${id}`) }))}>
        <div lang={language} dir={dirOf(language)} className="min-w-0">
          <NextIntlClientProvider locale={language} messages={documents[language]}>
            <RegisterDocument register={register} />
          </NextIntlClientProvider>
        </div>
      </WithContents>
    </Page>
  );
}

/** The register of one batch from the phone's records (REGISTER_ENTITIES), or null when the batch isn't there. */
export function registerOf(batchId: string, records: LocalRecord[], reference: ReferenceData | null, locale: string): Register | null {
  const all = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const batch = all<BatchDto>("batch").find((b) => b.id === batchId);
  const farm = batch && all<FarmDto>("farm").find((f) => f.id === batch.farmId);
  if (!batch || !farm) return null;
  const house = all<HouseDto>("house").find((h) => h.id === batch.houseId);
  return buildRegister({
    today: farmDayOf(new Date()),
    farm,
    house: house ?? null,
    strainName: reference?.strains.find((s) => s.id === batch.strainId)?.name ?? batch.strainId,
    batch,
    dailyEntries: all<DailyEntryDto>("dailyEntry"),
    eggsLaid: all<EggCollectionDto>("eggCollection").map((c) => ({ batchId: c.batchId, day: c.day, eggs: eggsIn(c.counts) })),
    vaccinations: all<VaccinationDto>("vaccination"),
    treatments: all<TreatmentDto>("treatment"),
    vetVisits: all<VetVisitDto>("vetVisit"),
    soldBirds: all<SoldBirdsDto>("soldBirds"),
    sales: all<SaleDto>("sale"),
    buyers: all<BuyerDto>("buyer"),
    disposals: all<DisposalDto>("disposal"),
    documents: all<DocumentDto>("document"),
    products: (reference?.products ?? []).map((p) => ({ id: p.id, name: locale === "ar" ? p.nameAr : p.nameFr })),
    stockItems: all<StockItemDto>("stockItem"),
  });
}

/** `id`: a target of the inspection pack's table of contents (it takes the focus when reached from there). */
export function Section({ title, children, heading: H = "h2", id }: { title: string; children: ReactNode; heading?: "h2" | "h3"; id?: string }) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} className="flex scroll-mt-4 flex-col gap-1 outline-none">
      <H className="text-base font-semibold">{title}</H>
      {children}
    </section>
  );
}

/**
 * A long document beside its contents (tasks/plan-ui-cleanup.md §4): wide screens, on the end side of the document, in
 * view while it scrolls (the app's sidebar is on the other); the phone, a row of links above it. First in the DOM, so the
 * keyboard reaches it first. Its links scroll without touching the hash, which names the record. Paper: the document alone.
 */
export function WithContents({ label, parts, children }: { label: string; parts: { id: string; label: string }[]; children: ReactNode }) {
  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ block: "start" });
    target.focus({ preventScroll: true });
  };
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_11rem] lg:items-start lg:gap-6 print:block">
      <nav aria-label={label} className="print:hidden lg:sticky lg:top-4 lg:order-last">
        <p className="mb-2 hidden text-sm font-semibold text-ink-2 lg:block" aria-hidden="true">{label}</p>
        <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-s lg:border-line">
          {parts.map((p) => (
            <li key={p.id} className="shrink-0">
              <a
                href={`#${p.id}`}
                onClick={(e) => go(e, p.id)}
                className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-line bg-card px-3 text-sm hover:bg-shell lg:min-h-8 lg:w-full lg:whitespace-normal lg:rounded-none lg:border-0 lg:bg-transparent lg:py-1 lg:ps-3 lg:text-ink-2 lg:hover:text-ink"
              >
                {p.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {children}
    </div>
  );
}

/** A table that says "none" rather than print an empty grid. On screen a wide one scrolls (zoom, phone); on paper it fits the page.
 * Each cell keeps its own direction: a Latin name or legal reference stays whole in an Arabic table.
 * On screen the look of the app's `dataTable` (layout.ts) in its card, a little denser (a register runs to hundreds of
 * rows); on paper a ruled grid, as before. Not `dataTableWrap`: it stops scrolling from lg, and a register's daily table
 * is wider than the column. */
export function Table({ head, rows, none }: { head: string[]; rows: ReactNode[][]; none: string }) {
  if (rows.length === 0) return <p className="text-sm">{none}</p>;
  return (
    <div className="overflow-x-auto rounded-[18px] bg-card shadow-[0_1px_2px_rgba(36,33,28,.06),0_6px_18px_rgba(36,33,28,.05)] print:overflow-visible print:rounded-none print:shadow-none">
      <table className="w-full text-sm [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:bg-shell [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-start [&_th]:font-medium [&_th]:text-ink-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-line print:[&_td]:border print:[&_td]:border-black print:[&_td]:px-1.5 print:[&_td]:py-1 print:[&_th]:border print:[&_th]:border-black print:[&_th]:px-1.5 print:[&_th]:py-1 print:[&_th]:font-semibold print:[&_th]:text-black">
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="break-inside-avoid">{r.map((c, j) => <td key={j}><bdi>{c}</bdi></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A label and its value; an empty value is a line to fill by hand (never invented, CQ1). */
function Line({ label, children, lines = 1 }: { label: string; children?: ReactNode; lines?: number }) {
  return (
    <div className="flex flex-col border-b border-line py-1 print:border-black">
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-semibold">{children ?? Array.from({ length: lines }, (_, i) => <span key={i} className="block h-7 border-b border-dotted border-ink-2 last:border-0" />)}</dd>
    </div>
  );
}

// Art. 8: a paginated paper register. "n / N" needs no word, so it reads the same in both languages.
const PAGINATION = '@page { @bottom-center { content: counter(page) " / " counter(pages); font-size: 9pt; } }';

/** embedded: inside the inspection pack, under its h1 (an h2 title, h3 sections) and printed with it. */
export function RegisterDocument({ register: r, embedded = false }: { register: Register; embedded?: boolean }) {
  const t = useTranslations("Register");
  const tr = useTranslations();
  const locale = useLocale();
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const month = (m: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const code = (c: string) => <bdi dir="ltr">{c}</bdi>; // a code keeps its order in Arabic
  const c = r.cover;
  const H = embedded ? "h2" : "h1";
  const sub = embedded ? "h3" : "h2";
  const at = (id: string) => (embedded ? undefined : id); // the contents' targets, on the register's own page only
  const paperOnly = embedded ? "" : " hidden print:block";
  const species = tr(`Types.${c.species}`);
  const vet = c.vet ? [c.vet.name, c.vet.address, c.vet.phone && code(c.vet.phone)].filter(Boolean).map((x, i) => <span key={i} className="block">{x}</span>) : undefined;
  const keepers = c.keepers.length > 0
    ? c.keepers.map((k, i) => <span key={i} className="block">{t(k.to ? "keeperValue" : "keeperSince", { name: k.name, position: k.position, from: day(k.from), to: k.to ? day(k.to) : "" })}</span>)
    : undefined;

  return (
    <article className="flex flex-col gap-4">
      <style>{PAGINATION}</style>
      <header className="flex flex-col border-b-2 border-ink pb-2">
        {/* On its own page, the page's header says these on screen; paper has them here. */}
        <H className={`text-2xl font-semibold${paperOnly}`}>{t("title")}</H>
        <p>{t("law")}</p>
        <p className={`text-ink-2${paperOnly}`}>{t("batchOf", { date: day(c.placedOn) })}</p>
      </header>

      <Section heading={sub} id={at("cover")} title={t("cover")}>
        <dl className="grid gap-x-6 text-sm sm:grid-cols-2 print:grid-cols-2">
          <Line label={t("onssaNumber")}>{c.onssa ? t.rich("onssaValue", { number: c.onssa.number, date: day(c.onssa.expiresOn), code: (x) => code(String(x)) }) : undefined}</Line>
          <Line label={t("farmName")}>{c.farmName}</Line>
          <Line label={t("farmAddress")}>{c.address}</Line>
          <Line label={t("hatchery")}>{c.hatchery} · {code(c.deliveryNote)}</Line>
          <Line label={t("holder")} lines={2}>{c.holder ? [c.holder.name, c.holder.address].filter(Boolean).join(", ") : undefined}</Line>
          <Line label={t("keepers")} lines={2}>{keepers}</Line>
          <Line label={t("vetSanitary")} lines={2}>{vet}</Line>
          {c.chickImportApproval && <Line label={t("chickImportApproval")}>{code(c.chickImportApproval)}</Line>}
          <Line label={t("houses")}>{c.house ? `${c.house}${c.areaM2 ? ` · ${formatCount(c.areaM2)} m²` : ""}` : undefined}</Line>
          <Line label={t("speciesStrain")}>{species} · {c.strain}</Line>
          <Line label={t("placedOn")}>{day(c.placedOn)}</Line>
          <Line label={t("placed")}>{t(c.freeChicks > 0 ? "placedFreeValue" : "placedValue", { birds: formatCount(c.placed), free: formatCount(c.freeChicks), dead: formatCount(c.deadOnArrival) })}</Line>
          <Line label={t("removedOn")}>{c.closedOn ? day(c.closedOn) : t("open")}</Line>
        </dl>
      </Section>

      <Section heading={sub} id={at("supervision")} title={t("supervision")}>
        <dl className="grid gap-x-6 text-sm sm:grid-cols-2 print:grid-cols-2">
          <Line label={t("vetSanitary")} lines={2}>{vet}</Line>
          <Line label={t("vetContract")}>
            {r.vetContracts.length > 0
              ? r.vetContracts.map((v) => <span key={v.title} className="block">{t("vetContractValue", { title: v.title, from: v.issuedOn ? day(v.issuedOn) : "…", to: v.expiresOn ? day(v.expiresOn) : "…" })}</span>)
              : undefined}
          </Line>
          <Line label={t("technician")} lines={2}>{c.technician ?? undefined}</Line>
        </dl>
      </Section>

      <Section heading={sub} id={at("daily")} title={t("daily")}>
        <Table
          none={t("none")}
          head={[t("date"), t("age"), t("onHand"), t("dead"), t("culled"), t("cumulative"), ...r.feedTypes.map((name) => t("feedOf", { name })), t("waterL"), ...(r.laying ? [t("eggs")] : []), t("observations")]}
          rows={r.days.map((d) => [
            day(d.day),
            d.age,
            formatCount(d.onHand),
            formatCount(d.dead),
            formatCount(d.culled),
            formatCount(d.cumulativeDead),
            ...d.feedGrams.map((g) => (g === null ? "" : formatKgValue(g))),
            d.waterMl === null ? "" : formatCount(Math.round(d.waterMl / 1000)),
            ...(r.laying ? [d.eggs === null ? "" : formatCount(d.eggs)] : []),
            [
              d.cause ? tr(`Day.causes.${d.cause}`) : "",
              d.note ?? "",
              ...d.treatments.map((name) => t("treatmentOf", { name })),
              d.withdrawal && d.treatments.length === 0 ? t("withdrawalOn") : "",
              ...d.vaccinations.map((name) => t("vaccinationOf", { name })),
              ...d.vetVisits.map((name) => t("vetVisitOf", { name })),
              ...d.labReports.map((title) => t("labReportOf", { title })),
              d.out ? t("outOf", { birds: formatCount(d.out) }) : "",
            ].filter(Boolean).join(" · "),
          ])}
        />
      </Section>

      <Section heading={sub} id={at("treatments")} title={t("treatments")}>
        <Table
          none={t("none")}
          head={[t("commercialName"), t("lot"), t("dose"), t("method"), t("startOn"), t("endOn"), t("reason"), t("prescriber"), t("prescriptionRef"), t("withdrawalEnd")]}
          rows={r.treatments.map((x) => [
            x.product,
            x.lot ? code(x.lot) : "",
            x.dose,
            x.route === "other" ? (x.routeNote ?? "") : x.route ? tr(`Treatment.routes.${x.route}`) : "",
            day(x.startOn),
            day(x.endOn),
            x.reason,
            x.prescriber,
            x.prescriptionRef ? code(x.prescriptionRef) : "",
            day(x.withdrawalEndsOn),
          ])}
        />
      </Section>

      <Section heading={sub} id={at("vaccinations")} title={t("vaccinations")}>
        <Table
          none={t("none")}
          head={[t("age"), t("vaccine"), t("commercialName"), t("lot"), t("method"), t("doneOn"), t("doses"), t("species")]}
          rows={r.vaccinations.map((v) => [
            v.age,
            v.product,
            v.done?.item ?? "",
            v.done?.lot ? code(v.done.lot) : "",
            tr(`Protocol.methods.${v.method}`),
            v.done ? day(v.done.on) : t("notDone", { date: day(v.dueOn) }),
            v.done ? formatCount(v.done.doses) : "",
            species,
          ])}
        />
      </Section>

      <Section heading={sub} id={at("birdsOut")} title={t("birdsOut")}>
        <Table
          none={t("none")}
          head={[t("date"), t("birds"), t("recipient"), t("destination"), t("weightKg"), t("originDocument")]}
          rows={r.birdsOut.map((o) => [
            day(o.day),
            formatCount(o.birds),
            [o.buyer, o.buyerAddress].filter(Boolean).join(", "),
            o.destination ? [o.destination.name, o.destination.address].filter(Boolean).join(", ") : "",
            formatKgValue(o.liveWeightGrams),
            code(o.originNumber),
          ])}
        />
      </Section>

      <Section heading={sub} id={at("disposals")} title={t("disposals")}>
        <Table
          none={t("none")}
          head={[t("date"), t("birds"), t("weightKg"), t("disposalMethod")]}
          rows={r.disposals.map((d) => [day(d.day), formatCount(d.birds), d.weightGrams === null ? "" : formatKgValue(d.weightGrams), d.method === "other" ? (d.methodNote ?? "") : tr(`Disposal.methods.${d.method}`)])}
        />
      </Section>

      <Section heading={sub} id={at("labReports")} title={t("labReports")}>
        <Table none={t("none")} head={[t("date"), t("labReport")]} rows={r.labReports.map((l) => [day(l.issuedOn), l.title])} />
      </Section>

      <Section heading={sub} id={at("visas")} title={t("visas")}>
        <p className="text-sm text-ink-2 print:text-black">{t("visasHint")}</p>
        <Table
          none={t("none")}
          head={[t("date"), t("vet"), t("diagnosis"), t("references"), t("signature")]}
          rows={r.visas.map((v) => (v.on ? [day(v.on), v.vetName, v.notes, "", ""] : [<span key="m" className="block min-h-12">{t("visaMonth", { month: month(v.month) })}</span>, "", "", "", ""]))}
        />
      </Section>

      <Section heading={sub} id={at("annexes")} title={t("annexes")}>
        <Table
          none={t("none")}
          head={[t("piece"), t("references"), tr("Inspection.state")]}
          rows={r.annexes.map((a) => [tr(`Register.pieces.${a.key}`), a.references.join(" · "), a.inVault ? t("inVault") : t("toAttach")])}
        />
      </Section>

      <footer className="flex break-inside-avoid flex-col gap-2 pt-2">
        <div className="flex h-28 flex-col rounded border border-ink p-2">
          <span>{t("holderVisa")}</span>
        </div>
        <p className="text-sm">{t("retention")}</p>
        <p className="text-center text-sm text-ink-2">{t("editedWith", { app: tr("App.name") })}</p>
      </footer>
    </article>
  );
}
