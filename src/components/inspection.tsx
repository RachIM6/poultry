"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import { REGISTER_ENTITIES } from "@/components/register-access";
import { RegisterDocument, Section, Table, registerOf } from "@/components/register-document";
import { danger, done, field, primary } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDateTime, formatDay } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { CLEANOUT_STEPS, type CleanoutDto, type ManureRemovalDto, type RodentCheckDto, type VisitDto } from "@/modules/biosecurity/shared";
import { byExpiry, documentState, type DocumentDto } from "@/modules/documents/shared";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto } from "@/modules/flock/shared";
import type { VaccinationDto, VetVisitDto } from "@/modules/health/shared";
import type { StockItemDto } from "@/modules/inventory/shared";
import { batchDowntime, type DowntimeRule } from "@/modules/planning/shared";
import { inPack, inspectionChecklist, inspectionSince, type Missing } from "@/modules/reporting/shared";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { startSync } from "@/offline/sync";

// SPEC-m2-compliance RP4 on the static /inspection shell: one farm's pack in one printable document, from the phone's
// records, offline. Owners and managers (the vault is theirs). The checklist's lines come from the texts, each with its
// source (CQ2); registers are kept for their retention period (CQ5), the logs for 12 months.

const ENTITIES = [...REGISTER_ENTITIES, "visit", "cleanout", "manureRemoval", "rodentCheck", "downtimeRule"];

const onHashChange = (notify: () => void) => (window.addEventListener("hashchange", notify), () => window.removeEventListener("hashchange", notify));
const useHash = () => useSyncExternalStore(onHashChange, () => decodeURIComponent(window.location.hash.slice(1)), () => "");

export function InspectionScreen() {
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
  return <Pack key={scopeKey(scope)} {...scope} />;
}

function Pack(scope: Scope) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  const locale = useLocale();
  const hash = useHash();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf(ENTITIES).toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  if (!can(scope, "documents.manage")) return <p>{t("Inspection.forbidden")}</p>;
  if (!records || reference === undefined) return null;

  const all = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const farms = all<FarmDto>("farm").sort((x, y) => x.name.localeCompare(y.name));
  const farm = farms.find((f) => f.id === hash) ?? farms[0];
  if (!farm) return <p>{t("Inspection.noFarm")}</p>;
  const today = farmDayOf(new Date());
  const since = inspectionSince(today);
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const inPeriod = (d: string) => d >= since;
  const houses = all<HouseDto>("house");
  const houseName = (id: string | null) => houses.find((h) => h.id === id)?.name ?? "—";
  const batches = all<BatchDto>("batch")
    .filter((b) => b.farmId === farm.id && inPack(b, today))
    .sort((x, y) => y.placedOn.localeCompare(x.placedOn));
  const documents = all<DocumentDto>("document").filter((d) => d.farmId === null || d.farmId === farm.id).sort(byExpiry);
  const cleanouts = all<CleanoutDto>("cleanout").filter((c) => c.farmId === farm.id && inPeriod(c.startedOn));
  const rodentChecks = all<RodentCheckDto>("rodentCheck").filter((r) => r.farmId === farm.id && inPeriod(r.day));
  const disinfected = new Map(all<CleanoutDto>("cleanout").flatMap((c) => c.steps.filter((s) => s.step === "disinfection").map((s) => [c.afterBatchId, s.day] as const)));
  const checklist = inspectionChecklist({
    today,
    farm,
    documents,
    batches: all<BatchDto>("batch"),
    cleanouts: all<CleanoutDto>("cleanout"),
    rodentChecks,
    vetVisits: all<VetVisitDto>("vetVisit"),
    vaccinations: all<VaccinationDto>("vaccination"),
    stockItems: all<StockItemDto>("stockItem"),
    // CQ3: planning's one rule, from the disinfection day else the removal
    downtimeOf: (b) => batchDowntime(all<DowntimeRule>("downtimeRule"), b, all<BatchDto>("batch").filter((x) => x.farmId === b.farmId), disinfected),
  });
  const missing = checklist.flatMap((l) => l.missing);
  const of = <T extends { farmId: string; day: string },>(entity: string) => all<T>(entity).filter((x) => x.farmId === farm.id && inPeriod(x.day)).sort((x, y) => y.day.localeCompare(x.day));
  const visits = all<VisitDto>("visit").filter((v) => v.farmId === farm.id && inPeriod(farmDayOf(new Date(v.enteredAt)))).sort((x, y) => y.enteredAt.localeCompare(x.enteredAt));
  const batchLabel = (id: string) => {
    const b = all<BatchDto>("batch").find((x) => x.id === id);
    return b ? t("Inspection.batch", { house: houseName(b.houseId), date: day(b.placedOn) }) : "—";
  };
  const month = (m: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const missingText = (m: Missing) =>
    m.key === "vetVisa" ? t("Inspection.missing.vetVisa", { month: month(m.month), batch: batchLabel(m.batchId) })
      : m.key === "downtime" ? t("Inspection.missing.downtime", { days: m.days, batch: batchLabel(m.batchId) })
      : m.key === "downtimeOccupied" ? t("Inspection.missing.downtimeOccupied", { house: houseName(m.houseId), batch: batchLabel(m.batchId) })
      : m.key === "noDisinfection" || m.key === "newcastle" || m.key === "newcastleLot" ? t(`Inspection.missing.${m.key}`, { batch: batchLabel(m.batchId) })
      : m.key === "rodentProof" ? t("Inspection.missing.rodentProof", { date: day(m.day) })
      : t(`Inspection.missing.${m.key}`);

  return (
    <article className="flex flex-col gap-6">
      {farms.length > 1 && (
        <label className="flex flex-col gap-1 print:hidden">
          {t("Biosecurity.farm")}
          {/* the farm goes in the hash: a reload or a language switch keeps it */}
          <select value={farm.id} onChange={(e) => window.location.replace(`#${encodeURIComponent(e.target.value)}`)} className={field}>
            {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      )}
      <header className="border-b-2 border-ink pb-2">
        <h1 className="text-2xl font-semibold">{t("Inspection.title", { farm: farm.name })}</h1>
        <p>{t("Inspection.period", { from: day(since), to: day(today) })}</p>
        <p>{farm.onssa ? t("Inspection.authorization", { number: farm.onssa.number, date: day(farm.onssa.expiresOn) }) : t("Inspection.noAuthorization")}</p>
      </header>

      <Section title={t("Inspection.checklist")}>
        <Table
          none={t("Register.none")}
          head={[t("Inspection.point"), t("Inspection.state"), t("Inspection.source")]}
          rows={checklist.map((l) => [t(`Inspection.lines.${l.key}`), t(`Inspection.states.${l.state}`), l.source])}
        />
        <p className="text-sm text-ink-2 print:text-black">{t("Inspection.selfDeclared")}</p>
        <p className="text-sm text-ink-2 print:text-black">{t("Inspection.threshold")}</p>
        <p className="text-sm text-ink-2 print:text-black">{t("Inspection.declaration")}</p>
        {missing.length === 0 ? (
          <p className={done}>{t("Inspection.complete")}</p>
        ) : (
          <ul className={`${danger} flex list-disc flex-col gap-1 ps-8`} aria-label={t("Inspection.toComplete")}>
            {missing.map((m, i) => <li key={i}>{missingText(m)}</li>)}
          </ul>
        )}
      </Section>

      <Section title={t("Inspection.documents")}>
        <Table
          none={t("Register.none")}
          head={[t("Documents.title"), t("Documents.category"), t("Inspection.expires"), t("Inspection.state"), t("Inspection.file")]}
          rows={documents.map((d) => [
            d.title,
            t(`Documents.categories.${d.category}`),
            d.expiresOn ? day(d.expiresOn) : "—",
            t(`Documents.states.${documentState(d.expiresOn, today)}`),
            d.fileId ? <a href={`/api/files/${d.fileId}`} className="underline underline-offset-4">{t("Documents.file")}</a> : t("Inspection.noFile"),
          ])}
        />
      </Section>

      <Section title={t("Cleanout.title")}>
        <Table
          none={t("Register.none")}
          head={[t("Disposal.house"), t("Inspection.after"), t("Inspection.steps"), t("Cleanout.steps.disinfection")]}
          rows={cleanouts.map((c) => {
            const disinfection = c.steps.find((s) => s.step === "disinfection");
            return [houseName(c.houseId), batchLabel(c.afterBatchId), `${c.steps.length} / ${CLEANOUT_STEPS.length}`, disinfection ? `${day(disinfection.day)} · ${disinfection.product ?? ""}` : "—"];
          })}
        />
      </Section>

      <Section title={t("Visitors.open")}>
        <Table
          none={t("Register.none")}
          head={[t("Register.date"), t("Visitors.visitor"), t("Visitors.purpose"), t("Inspection.recentFarm"), t("Visitors.zone")]}
          rows={visits.map((v) => [formatDateTime(v.enteredAt, locale), v.visitor, t(`Visitors.purposes.${v.purpose}`), v.recentFarm ? t("Inspection.yes") : t("Inspection.no"), t(`Visitors.zones.${v.zone}`)])}
        />
      </Section>

      <Section title={t("Register.disposals")}>
        <Table
          none={t("Register.none")}
          head={[t("Register.date"), t("Register.birds"), t("Register.disposalMethod")]}
          rows={of<{ farmId: string; day: string; birds: number; method: string; methodNote: string | null }>("disposal").map((d) => [day(d.day), formatCount(d.birds), d.method === "other" ? (d.methodNote ?? "") : t(`Disposal.methods.${d.method}`)])}
        />
      </Section>

      <Section title={t("Disposal.tab.manure")}>
        <Table
          none={t("Register.none")}
          head={[t("Register.date"), t("Disposal.quantity"), t("Disposal.destination"), t("Disposal.recipient")]}
          rows={of<ManureRemovalDto>("manureRemoval").map((r) => [day(r.day), formatCount(r.quantityKg), t(`Disposal.destinations.${r.destination}`), r.recipient ?? ""])}
        />
      </Section>

      <Section title={t("Inspection.rodents")}>
        <Table
          none={t("Register.none")}
          head={[t("Register.date"), t("Disposal.rodentAction"), t("Disposal.house"), t("Inspection.proof")]}
          rows={rodentChecks.sort((x, y) => y.day.localeCompare(x.day)).map((r) => [
            day(r.day),
            t(`Disposal.rodentActions.${r.action}`),
            houseName(r.houseId),
            r.proofFileId ? <a href={`/api/files/${r.proofFileId}`} className="underline underline-offset-4">{t("Disposal.proof")}</a> : t("Inspection.noFile"),
          ])}
        />
      </Section>

      {batches.map((b) => {
        const register = registerOf(b.id, records, reference?.data ?? null, locale);
        return register && (
          <section key={b.id} className="break-before-page">
            <RegisterDocument register={register} embedded />
          </section>
        );
      })}

      <button type="button" onClick={() => window.print()} className={`${primary} print:hidden`}>{t("Register.print")}</button>
    </article>
  );
}
