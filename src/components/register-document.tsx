"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { primary } from "@/components/ui";
import { Link } from "@/i18n/navigation";
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

// SPEC-m2-compliance RP2 on the static /register shell: the "registre de suivi sanitaire" of one batch
// (/register#<batch id>), built on the phone so it prints offline, in the page's language. Print CSS only, no PDF
// library (D1). Sections in the order of arrêté n° 2126-05 art. 2, on paper and paginated (art. 8); what the app
// doesn't record is a blank line to fill by hand (CQ1).

export const REGISTER_ENTITIES = ["farm", "house", "batch", "dailyEntry", "vaccination", "treatment", "vetVisit", "soldBirds", "sale", "buyer", "disposal", "document", "stockItem", "eggCollection"];

const onHashChange = (notify: () => void) => (window.addEventListener("hashchange", notify), () => window.removeEventListener("hashchange", notify));
const useHash = () => useSyncExternalStore(onHashChange, () => decodeURIComponent(window.location.hash.slice(1)), () => "");

export function RegisterScreen() {
  const t = useTranslations("Sync");
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return null;
  if (scope === null) {
    return (
      <p>
        {t("signedOut")} <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
      </p>
    );
  }
  return <RegisterOf key={scopeKey(scope)} {...scope} />;
}

function RegisterOf({ userId, organizationId, role }: Scope) {
  const t = useTranslations("Register");
  const locale = useLocale();
  const batchId = useHash();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf(REGISTER_ENTITIES).toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  if (!records || reference === undefined) return null;

  const register = registerOf(batchId, records, reference?.data ?? null, locale);
  return register ? <RegisterDocument register={register} /> : <p>{t("notFound")}</p>;
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

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A table that says "none" rather than print an empty grid. */
export function Table({ head, rows, none }: { head: string[]; rows: ReactNode[][]; none: string }) {
  if (rows.length === 0) return <p className="text-sm">{none}</p>;
  return (
    <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-line [&_td]:px-1.5 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:border-line [&_th]:bg-shell [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-start [&_th]:font-semibold print:[&_td]:border-black print:[&_th]:border-black">
      <thead>
        <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="break-inside-avoid">{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
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

export function RegisterDocument({ register: r, printButton = true }: { register: Register; printButton?: boolean }) {
  const t = useTranslations("Register");
  const tr = useTranslations();
  const locale = useLocale();
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const month = (m: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const code = (c: string) => <bdi dir="ltr">{c}</bdi>; // a code keeps its order in Arabic
  const c = r.cover;
  const species = tr(`Types.${c.species}`);

  return (
    <article className="flex flex-col gap-4">
      <style>{PAGINATION}</style>
      <header className="flex flex-col border-b-2 border-ink pb-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p>{t("law")}</p>
        <p className="text-ink-2">{t("batchOf", { date: day(c.placedOn) })}</p>
      </header>

      <Section title={t("cover")}>
        <dl className="grid gap-x-6 text-sm sm:grid-cols-2 print:grid-cols-2">
          <Line label={t("onssaNumber")}>{c.onssa ? t.rich("onssaValue", { number: c.onssa.number, date: day(c.onssa.expiresOn), code: (x) => code(String(x)) }) : undefined}</Line>
          <Line label={t("farmName")}>{c.farmName}</Line>
          <Line label={t("farmAddress")}>{c.address}</Line>
          <Line label={t("hatchery")}>{c.hatchery} · {code(c.deliveryNote)}</Line>
          <Line label={t("holder")} lines={2} />
          <Line label={t("keepers")} lines={2} />
          <Line label={t("vetSanitary")} lines={2} />
          <Line label={t("houses")}>{c.house ? `${c.house}${c.areaM2 ? ` · ${formatCount(c.areaM2)} m²` : ""}` : undefined}</Line>
          <Line label={t("speciesStrain")}>{species} · {c.strain}</Line>
          <Line label={t("placedOn")}>{day(c.placedOn)}</Line>
          <Line label={t("placed")}>{t("placedValue", { birds: formatCount(c.chicksPlaced), dead: formatCount(c.deadOnArrival) })}</Line>
          <Line label={t("removedOn")}>{c.closedOn ? day(c.closedOn) : t("open")}</Line>
        </dl>
      </Section>

      <Section title={t("supervision")}>
        <dl className="grid gap-x-6 text-sm sm:grid-cols-2 print:grid-cols-2">
          <Line label={t("vetSanitary")} lines={2} />
          <Line label={t("vetContract")}>
            {r.vetContracts.length > 0
              ? r.vetContracts.map((v) => <span key={v.title} className="block">{t("vetContractValue", { title: v.title, from: v.issuedOn ? day(v.issuedOn) : "…", to: v.expiresOn ? day(v.expiresOn) : "…" })}</span>)
              : undefined}
          </Line>
          <Line label={t("technician")} lines={2} />
        </dl>
      </Section>

      <Section title={t("daily")}>
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

      <Section title={t("treatments")}>
        <Table
          none={t("none")}
          head={[t("commercialName"), t("lot"), t("dose"), t("startOn"), t("endOn"), t("reason"), t("prescriber"), t("withdrawalEnd")]}
          rows={r.treatments.map((x) => [x.product, x.lot ? code(x.lot) : "", x.dose, day(x.startOn), day(x.endOn), x.reason, x.prescriber, day(x.withdrawalEndsOn)])}
        />
      </Section>

      <Section title={t("vaccinations")}>
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

      <Section title={t("birdsOut")}>
        <Table
          none={t("none")}
          head={[t("date"), t("birds"), t("recipient"), t("weightKg"), t("originDocument")]}
          rows={r.birdsOut.map((o) => [day(o.day), formatCount(o.birds), o.buyer ?? "", formatKgValue(o.liveWeightGrams), code(o.originNumber)])}
        />
      </Section>

      <Section title={t("disposals")}>
        <Table
          none={t("none")}
          head={[t("date"), t("birds"), t("weightKg"), t("disposalMethod")]}
          rows={r.disposals.map((d) => [day(d.day), formatCount(d.birds), d.weightGrams === null ? "" : formatKgValue(d.weightGrams), d.method === "other" ? (d.methodNote ?? "") : tr(`Disposal.methods.${d.method}`)])}
        />
      </Section>

      <Section title={t("labReports")}>
        <Table none={t("none")} head={[t("date"), t("labReport")]} rows={r.labReports.map((l) => [day(l.issuedOn), l.title])} />
      </Section>

      <Section title={t("visas")}>
        <p className="text-sm text-ink-2 print:text-black">{t("visasHint")}</p>
        <Table
          none={t("none")}
          head={[t("date"), t("vet"), t("diagnosis"), t("references"), t("signature")]}
          rows={r.visas.map((v) => (v.on ? [day(v.on), v.vetName, v.notes, "", ""] : [<span key="m" className="block min-h-12">{t("visaMonth", { month: month(v.month) })}</span>, "", "", "", ""]))}
        />
      </Section>

      <Section title={t("annexes")}>
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
      {printButton && <button type="button" onClick={() => window.print()} className={`${primary} print:hidden`}>{t("print")}</button>}
    </article>
  );
}
