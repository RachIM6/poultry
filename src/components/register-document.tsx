"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { primary, warn } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay, formatKgValue } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { DisposalDto } from "@/modules/biosecurity/shared";
import type { DocumentDto } from "@/modules/documents/shared";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto, DailyEntryDto, SoldBirdsDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto, VetVisitDto } from "@/modules/health/shared";
import type { StockItemDto } from "@/modules/inventory/shared";
import type { ReferenceData } from "@/modules/reference-data/schema";
import { buildRegister, type Register } from "@/modules/reporting/shared";
import type { BuyerDto, SaleDto } from "@/modules/sales/shared";
import { cachedReference, currentScope, localDb, scopeKey, type LocalRecord, type Scope } from "@/offline/db";
import { startSync } from "@/offline/sync";

// SPEC-m2-compliance RP2 on the static /register shell: the health monitoring register of one batch
// (/register#<batch id>), built on the phone so it prints offline, in the page's language. Print CSS only, no PDF
// library (D1). The layout is provisional until ONSSA's template arrives (CQ1), and says so.

export const REGISTER_ENTITIES = ["farm", "house", "batch", "dailyEntry", "vaccination", "treatment", "vetVisit", "soldBirds", "sale", "buyer", "disposal", "document", "stockItem"];

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
    farm,
    house: house ?? null,
    strainName: reference?.strains.find((s) => s.id === batch.strainId)?.name ?? batch.strainId,
    batch,
    dailyEntries: all<DailyEntryDto>("dailyEntry"),
    vaccinations: all<VaccinationDto>("vaccination"),
    treatments: all<TreatmentDto>("treatment"),
    vetVisits: all<VetVisitDto>("vetVisit"),
    soldBirds: all<SoldBirdsDto>("soldBirds"),
    sales: all<SaleDto>("sale"),
    buyers: all<BuyerDto>("buyer"),
    disposals: all<DisposalDto>("disposal"),
    labReports: all<DocumentDto>("document"),
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

export function RegisterDocument({ register: r, printButton = true }: { register: Register; printButton?: boolean }) {
  const t = useTranslations("Register");
  const tr = useTranslations();
  const locale = useLocale();
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const code = (c: string) => <bdi dir="ltr">{c}</bdi>; // a code keeps its order in Arabic
  const c = r.cover;

  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-wrap justify-between gap-4 border-b-2 border-ink pb-2">
        <div className="flex flex-col">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p>{t("law")}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
          <dt className="text-ink-2">{t("farm")}</dt>
          <dd className="font-semibold">{c.farmName}</dd>
          <dt className="text-ink-2">{t("address")}</dt>
          <dd>{c.address}</dd>
          <dt className="text-ink-2">{t("onssa")}</dt>
          <dd>{c.onssa ? t.rich("onssaValue", { number: c.onssa.number, date: day(c.onssa.expiresOn), code: (x) => code(String(x)) }) : t("onssaNone")}</dd>
        </dl>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 print:grid-cols-4">
        {[
          [t("house"), c.house ? `${c.house}${c.areaM2 ? ` · ${formatCount(c.areaM2)} m²` : ""}` : "—"],
          [t("strain"), c.strain],
          [t("origin"), <>{c.hatchery} · {code(c.deliveryNote)}</>],
          [t("placement"), `${day(c.placedOn)} · ${formatCount(c.chicksPlaced)}`],
          [t("deadOnArrival"), formatCount(c.deadOnArrival)],
          [t("closedOn"), c.closedOn ? day(c.closedOn) : t("open")],
        ].map(([label, value], i) => (
          <div key={i} className="border border-line p-2 print:border-black">
            <dt className="text-ink-2">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <Section title={t("daily")}>
        <Table
          none={t("none")}
          head={[t("date"), t("age"), t("onHand"), t("dead"), t("culled"), t("cause"), t("feedKg"), t("waterL"), t("treatment")]}
          rows={r.days.map((d) => [
            day(d.day),
            d.age,
            formatCount(d.onHand),
            formatCount(d.dead),
            formatCount(d.culled),
            d.cause ? tr(`Day.causes.${d.cause}`) : "",
            d.feedGrams === null ? "" : formatKgValue(d.feedGrams),
            d.waterMl === null ? "" : formatCount(Math.round(d.waterMl / 1000)),
            [...d.treatments, d.withdrawal && d.treatments.length === 0 ? t("inWithdrawal") : "", d.out ? t("out", { birds: formatCount(d.out) }) : ""].filter(Boolean).join(" · "),
          ])}
        />
      </Section>

      <Section title={t("vaccinations")}>
        <Table
          none={t("none")}
          head={[t("age"), t("product"), t("lot"), t("method"), t("doneOn")]}
          rows={r.vaccinations.map((v) => [v.age, v.product, v.done?.lot ? code(v.done.lot) : "", tr(`Protocol.methods.${v.method}`), v.done ? day(v.done.on) : t("notDone", { date: day(v.dueOn) })])}
        />
      </Section>

      <Section title={t("treatments")}>
        <Table
          none={t("none")}
          head={[t("age"), t("product"), t("lot"), t("dose"), t("reason"), t("prescriber"), t("withdrawalEnd")]}
          rows={r.treatments.map((x) => [
            x.ageFrom === x.ageTo ? x.ageFrom : `${x.ageFrom}–${x.ageTo}`,
            x.product,
            x.lot ? code(x.lot) : "",
            x.dose,
            x.reason,
            x.prescriber,
            day(x.withdrawalEndsOn),
          ])}
        />
      </Section>

      <Section title={t("vetVisits")}>
        <Table none={t("none")} head={[t("date"), t("vet"), t("notes")]} rows={r.vetVisits.map((v) => [day(v.on), v.vetName, v.notes])} />
      </Section>

      <Section title={t("birdsOut")}>
        <Table
          none={t("none")}
          head={[t("date"), t("buyer"), t("birds"), t("weightKg"), t("originDocument")]}
          rows={r.birdsOut.map((o) => [day(o.day), o.buyer ?? "—", formatCount(o.birds), formatKgValue(o.liveWeightGrams), code(o.originNumber)])}
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
        <Table none={t("none")} head={[t("date"), t("labReport")]} rows={r.labReports.map((l) => [l.issuedOn ? day(l.issuedOn) : "", l.title])} />
      </Section>

      <footer className="grid break-inside-avoid grid-cols-2 gap-4 pt-2">
        {[t("signFarmer"), t("signVet")].map((label) => (
          <div key={label} className="flex h-28 flex-col rounded border border-ink p-2">
            <span>{label}</span>
          </div>
        ))}
        <p className={`col-span-2 text-sm ${warn} print:bg-transparent print:p-0 print:text-black`}>{t("provisional")}</p>
        <p className="col-span-2 text-center text-sm text-ink-2">{t("editedWith", { app: tr("App.name") })}</p>
      </footer>
      {printButton && <button type="button" onClick={() => window.print()} className={`${primary} print:hidden`}>{t("print")}</button>}
    </article>
  );
}
