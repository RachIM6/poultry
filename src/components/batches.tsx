"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";
import { formatCount } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { pulls } from "@/lib/sync/views";
import type { CleanoutDto } from "@/modules/biosecurity/shared";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { TreasuryAccountDto } from "@/modules/finance/shared";
import { ageOn, birdsOnHand, birdsStarted, canJoinHouse, type BatchCostDto, type BatchDto, type DailyEntryDto, type SoldBirdsDto, type WeighingDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto, VetVisitDto } from "@/modules/health/shared";
import type { EggCollectionDto } from "@/modules/eggs/shared";
import type { DowntimeRule } from "@/modules/planning/shared";
import type { StockItemDto } from "@/modules/inventory/shared";
import type { ProtocolDto } from "@/modules/reference-data/schema";
import type { BuyerDto, SaleDto } from "@/modules/sales/shared";
import dynamic from "next/dynamic";
import { ageText as batchAge } from "@/components/batch-age";
import { DayForm, type Write } from "@/components/daily-entry";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";
import { BatchStrip, stripDays } from "@/components/batch-strip";
import { card, link, primary } from "@/components/ui";

// SPEC §9.3 budget (ADR-009, T25): the day's entry loads with the page; the rest of the batch screen comes in its own
// chunks right after. The service worker precaches every chunk, so they load offline too.
const BatchDashboard = dynamic(() => import("@/components/batch-dashboard").then((m) => m.BatchDashboard));
const PlacementForm = dynamic(() => import("@/components/placement").then((m) => m.PlacementForm));
const LayerDashboard = dynamic(() => import("@/components/layer-dashboard").then((m) => m.LayerDashboard));
const BatchCosts = dynamic(() => import("@/components/closing").then((m) => m.BatchCosts));
const CloseBatchForm = dynamic(() => import("@/components/closing").then((m) => m.CloseBatchForm));
const TransferForm = dynamic(() => import("@/components/closing").then((m) => m.TransferForm));
const CorrectPlacement = dynamic(() => import("@/components/correct-placement").then((m) => m.CorrectPlacement));
const ClosedSummary = dynamic(() => import("@/components/closing").then((m) => m.ClosedSummary));
const Sales = dynamic(() => import("@/components/sales").then((m) => m.Sales));
const Treatments = dynamic(() => import("@/components/treatments").then((m) => m.Treatments));
const VetVisits = dynamic(() => import("@/components/treatments").then((m) => m.VetVisits));
const WithdrawalBanner = dynamic(() => import("@/components/treatments").then((m) => m.WithdrawalBanner));
const EggCollections = dynamic(() => import("@/components/eggs").then((m) => m.EggCollections));
const Vaccinations = dynamic(() => import("@/components/vaccinations").then((m) => m.Vaccinations));
const Weighings = dynamic(() => import("@/components/weighing").then((m) => m.Weighings));
const BatchHeader = dynamic(() => import("@/components/batch-dashboard").then((m) => m.BatchHeader));
const BatchNotes = dynamic(() => import("@/components/batch-dashboard").then((m) => m.BatchNotes));
const OpenBatchCard = dynamic(() => import("@/components/batch-dashboard").then((m) => m.OpenBatchCard));
const RegisterLinks = dynamic(() => import("@/components/register-links").then((m) => m.RegisterLinks));
const TurkeySexes = dynamic(() => import("@/components/turkey-sexes").then((m) => m.TurkeySexes));

// SPEC B1 on the static /batches shell: from and to the phone's database (ADR-003). The one-open-batch rule is checked
// here for a quick answer and enforced by the server, which rejects the second of two phones placing offline.

const today = () => farmDayOf(new Date());

// A batch's day opens as /batches#<id>: the path stays the precached shell, offline included.
const onHashChange = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const useHash = () => useSyncExternalStore(onHashChange, () => decodeURIComponent(window.location.hash.slice(1)), () => "");

export function BatchesScreen() {
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
  return <Batches key={scopeKey(scope)} {...scope} />;
}

function Batches(scope: Scope) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  const locale = useLocale();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "dailyEntry", "weighing", "stockItem", "protocol", "vaccination", "treatment", "vetVisit", "soldBirds", "buyer", "sale", "batchCost", "eggCollection", "cleanout", "downtimeRule", "treasuryAccount").toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState<string>();
  const openId = useHash();
  if (!records || reference === undefined) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const farms = new Map(of<FarmDto>("farm").map((f) => [f.id, f]));
  const houses = of<HouseDto>("house");
  const openFirst = (b: BatchDto) => (b.status === "open" ? 0 : 1);
  // SPEC-m3 B11: a run's open beldi bands stay together, oldest first; then the rest, latest placement first.
  const band = (b: BatchDto) => (b.status === "open" && b.species === "beldi" ? b.houseId : "");
  const batches = of<BatchDto>("batch").sort(
    (x, y) => openFirst(x) - openFirst(y) || band(y).localeCompare(band(x)) || (band(x) ? x.placedOn.localeCompare(y.placedOn) : y.placedOn.localeCompare(x.placedOn)),
  );
  const strains = reference?.data.strains ?? [];
  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? "";
  const busy = new Set(batches.filter((b) => b.status === "open").map((b) => b.houseId));
  const entries = of<DailyEntryDto>("dailyEntry");
  const entriesOf = (batchId: string) => entries.filter((e) => e.batchId === batchId);
  const soldOf = (batchId: string) => of<SoldBirdsDto>("soldBirds").filter((s) => s.batchId === batchId);
  const onHand = (b: BatchDto) => birdsOnHand(birdsStarted(b), entriesOf(b.id), soldOf(b.id)); // B5: sold count too
  // SPEC-m5 §5: the accountant's phone holds no daily entry, so no bird count, strip or batch figure is shown to them.
  const farming = pulls(role, "dailyEntry");

  // tasks/plan-ui.md U4: the 42-day strip on each card and on the batch page (Batch.dc.html).
  const vaccinationsOf = (batchId: string) => of<VaccinationDto>("vaccination").filter((v) => v.batchId === batchId);
  const stripOf = (b: BatchDto) => {
    const its = of<TreatmentDto>("treatment").filter((x) => x.batchId === b.id);
    // H4's rule (health's withdrawalUntil) read from each treatment's withdrawalEndsOn, which the same rule computed when
    // it was recorded: importing health here would push the page over its 200 KB budget (SPEC §9.3).
    const running = its.filter((x) => x.startOn <= today() && today() <= x.withdrawalEndsOn).map((x) => x.withdrawalEndsOn).sort();
    const until = (running.at(-1) ?? null) as FarmDay | null;
    const from = its.filter((x) => x.withdrawalEndsOn >= today()).map((x) => x.startOn).sort()[0];
    const age = ageOn(b.placedOn as FarmDay, today());
    const days = stripDays({
      placedOn: b.placedOn as FarmDay,
      today: today(),
      age,
      entered: new Set(entriesOf(b.id).map((e) => e.day)),
      vaccineDays: vaccinationsOf(b.id).filter((v) => !v.done).map((v) => v.dueOn),
      withdrawal: until && from ? { from: from as FarmDay, to: until } : null,
      rolling: b.species !== "broiler", // SPEC-m3: long cycles show a rolling window
    });
    return { age, days, label: t("Today.stripLabel", { day: String(age), missing: String(days.filter((d) => d.state === "missing").length) }) };
  };

  const write: Write = async (mutation, recs) => {
    try {
      await writeLocal(db, mutation, recs);
      setMessage("Farms.saved");
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };

  const shown = batches.find((b) => b.id === openId);
  const ageText = (b: BatchDto) => batchAge(t, b, today());
  const strainName = (id: string) => (id.startsWith("unspecified-") ? t("Batches.unspecifiedStrain") : (strains.find((s) => s.id === id)?.name ?? id));
  const sexOf = (b: BatchDto) => (b.sex && b.sex !== "mixed" ? ` · ${t(`Batches.sexes.${b.sex}`)}` : ""); // SPEC-m3 B9
  const title = (b: BatchDto) => `${t(`Types.${b.species}`)}${sexOf(b)} · ${t("Batches.summary", { farm: farms.get(b.farmId)?.name ?? "", house: houseName(b.houseId), strain: strainName(b.strainId) })}`;
  const collectionsOf = (batchId: string) => of<EggCollectionDto>("eggCollection").filter((c) => c.batchId === batchId);
  const layingCurve = (b: BatchDto) => strains.find((s) => s.id === b.strainId)?.layingCurves?.at(-1)?.points ?? null; // latest version (R7)
  const nextVaccine = (batchId: string) => {
    const v = vaccinationsOf(batchId).filter((x) => !x.done).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
    if (!v) return null;
    const p = reference?.data.products.find((x) => x.id === v.productId);
    return `${p ? (locale === "ar" ? p.nameAr : p.nameFr) : v.productId} · ${t("Batches.age", { age: String(v.dayOfAge) })}`;
  };
  const costsOf = (batchId: string) => of<BatchCostDto>("batchCost").filter((c) => c.batchId === batchId);
  if (shown?.status === "closed") {
    // B6: read-only, with the locked figures; its sales stay listed for their origin documents (V5).
    const curves = strains.find((s) => s.id === shown.strainId)?.curves ?? [];
    return (
      <>
        <BatchHeader title={title(shown)} />
        <RegisterLinks batchId={shown.id} scope={scope} />
        {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
        <ClosedSummary batch={shown} money={can(scope, "money.read")} />
        {!farming ? (
          <p className="text-sm text-ink-2">{t("Batches.noFarming")}</p>
        ) : shown.species === "layer" ? (
          <LayerDashboard batch={shown} entries={entriesOf(shown.id)} sold={soldOf(shown.id)} collections={collectionsOf(shown.id)} curve={layingCurve(shown)} />
        ) : (
          <BatchDashboard batch={shown} entries={entriesOf(shown.id)} weighings={of<WeighingDto>("weighing").filter((w) => w.batchId === shown.id)} sold={soldOf(shown.id)} curves={curves} />
        )}
        <BatchCosts batch={shown} costs={costsOf(shown.id)} manage={can(scope, "flock.manage")} />
        {can(scope, "sales.manage") && <Sales batch={shown} sales={of<SaleDto>("sale")} buyers={of<BuyerDto>("buyer")} treatments={[]} birdsOnHand={0} write={write} />}
      </>
    );
  }

  const open = shown;
  if (open && !farming) {
    return (
      <>
        <BatchHeader title={title(open)} />
        <RegisterLinks batchId={open.id} scope={scope} />
        <p className="text-sm text-ink-2">{t("Batches.noFarming")}</p>
      </>
    );
  }
  if (open) {
    const weighings = of<WeighingDto>("weighing").filter((w) => w.batchId === open.id);
    const curves = strains.find((s) => s.id === open.strainId)?.curves ?? []; // its sex's is picked where shown (OQ5, R6)
    const treatments = of<TreatmentDto>("treatment").filter((x) => x.batchId === open.id);
    return (
      <>
        <BatchHeader title={title(open)} />
        <RegisterLinks batchId={open.id} scope={scope} />
        <OpenBatchCard
          strip={stripOf(open)}
          ageLabel={open.species === "broiler" ? undefined : ageText(open)} // SPEC-m3: weeks for the long cycles
          birds={t("Day.onHand", { birds: formatCount(onHand(open)) })}
          next={nextVaccine(open.id)}
        />
        {open.sex && open.sex !== "mixed" && <TurkeySexes batch={open} batches={batches} entries={entries} weighings={of<WeighingDto>("weighing")} sold={of<SoldBirdsDto>("soldBirds")} />}
        <BatchNotes
          batch={open}
          areaM2={houses.find((h) => h.id === open.houseId)?.areaM2}
          claimPermille={farms.get(open.farmId)?.doaClaimThresholdPermille}
        />
        <WithdrawalBanner treatments={treatments} />
        {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
        {open.species === "layer" ? (
          <LayerDashboard batch={open} entries={entriesOf(open.id)} sold={soldOf(open.id)} collections={collectionsOf(open.id)} curve={layingCurve(open)} />
        ) : (
          <BatchDashboard batch={open} entries={entriesOf(open.id)} weighings={weighings} sold={soldOf(open.id)} curves={curves} />
        )}
        {can(scope, "flock.record") && (
          <DayForm
            batch={open}
            entries={entriesOf(open.id)}
            sold={soldOf(open.id)}
            feedItems={of<StockItemDto>("stockItem").filter((i) => i.farmId === open.farmId && i.kind === "feed")}
            write={write}
          />
        )}
        {open.species === "layer" && can(scope, "eggs.record") && (
          <>
            <Link href="/eggs" className={link}>{t("EggStock.title")}</Link>
            <EggCollections batch={open} collections={collectionsOf(open.id)} write={write} />
          </>
        )}
        <Weighings
          batch={open}
          weighings={weighings}
          curves={curves}
          write={can(scope, "flock.record") ? write : undefined} // the vet reads them (SPEC-m5 PA4)
        />
        <Vaccinations
          batch={open}
          vaccinations={of<VaccinationDto>("vaccination").filter((v) => v.batchId === open.id)}
          products={reference?.data.products ?? []}
          lots={of<StockItemDto>("stockItem").filter((i) => i.farmId === open.farmId && i.kind === "vaccine")}
          birdsOnHand={onHand(open)}
          userId={userId}
          protocols={of<ProtocolDto>("protocol")}
          manage={can(scope, "health.manage")}
          write={write}
        />
        {can(scope, "health.record") && (
          <>
            <Treatments
              batch={open}
              treatments={treatments}
              medicines={of<StockItemDto>("stockItem").filter((i) => i.farmId === open.farmId && i.kind === "medicine")}
              userId={userId}
              write={write}
            />
            <VetVisits batch={open} visits={of<VetVisitDto>("vetVisit").filter((v) => v.batchId === open.id)} userId={userId} write={write} />
          </>
        )}
        {can(scope, "flock.record") && (
          <Sales
            batch={open}
            sales={of<SaleDto>("sale")}
            buyers={of<BuyerDto>("buyer")}
            treatments={treatments}
            birdsOnHand={onHand(open)}
            seller={can(scope, "sales.manage")}
            write={write}
          />
        )}
        <BatchCosts batch={open} costs={costsOf(open.id)} manage={can(scope, "flock.manage")} />
        {can(scope, "flock.manage") && open.species === "pullet" && (
          <TransferForm
            batch={open}
            onHand={onHand(open)}
            houses={houses.map((h) => ({
              id: h.id,
              label: `${farms.get(h.farmId)?.name ?? ""} · ${h.name}`,
              free: canJoinHouse("layer", batches.filter((b) => b.status === "open" && b.houseId === h.id && b.id !== open.id)).ok, // its own house too (B13)
            }))}
            write={write}
          />
        )}
        {can(scope, "flock.manage") && !open.fromBatchId && (
          <CorrectPlacement batch={open} title={title(open)} houses={houses} batches={batches} entries={entriesOf(open.id)} weighings={weighings} sold={soldOf(open.id)} strains={strains} vaccinations={vaccinationsOf(open.id)} write={write} />
        )}
        {can(scope, "flock.manage") && <CloseBatchForm batch={open} write={write} />}
      </>
    );
  }

  const protocols = of<ProtocolDto>("protocol").sort((x, y) => x.name.localeCompare(y.name));
  const placed = (ok: boolean) => {
    setMessage(ok ? "Farms.saved" : "Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    if (ok) setPlacing(false);
  };

  return (
    <>
      {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
      {!farming && batches.length > 0 && <p className="text-sm text-ink-2">{t("Batches.noFarming")}</p>}
      {batches.length === 0 ? (
        <p>{t("Batches.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((b, i) => (
            <Fragment key={b.id}>
            {farming && band(b) && (i === 0 || band(batches[i - 1]) !== band(b)) ? (
              <li className="pt-2 font-semibold">
                {(() => {
                  const run = batches.filter((x) => band(x) === band(b));
                  return t("Batches.run", { house: houseName(b.houseId), bands: String(run.length), birds: formatCount(run.reduce((n, x) => n + onHand(x), 0)) });
                })()}
              </li>
            ) : null}
            <li className={card}>
              <span className="font-semibold">
                {b.status === "open" ? ageText(b) : t("Batches.status.closed")}
              </span>
              {farming && b.status === "open" && <BatchStrip {...stripOf(b)} />}
              <span>{title(b)}</span>
              <span className="text-sm text-muted">{t("Batches.chicks", { chicks: formatCount(b.chicksPlaced), doa: formatCount(b.deadOnArrival) })}</span>
              {farming && <span>{t("Day.onHand", { birds: formatCount(onHand(b)) })}</span>}
              {b.status === "open" ? (
                <a href={`#${b.id}`} className={`${primary} mt-2`}>{t("Day.open")}</a>
              ) : (
                <a href={`#${b.id}`} className={link}>{t("Closing.open")}</a>
              )}
            </li>
            </Fragment>
          ))}
        </ul>
      )}
      {can(scope, "flock.manage") &&
        (houses.length === 0 ? (
          <p>
            {t("Batches.noHouse")} <Link href="/farms" className="underline underline-offset-4">{t("Farms.title")}</Link>
          </p>
        ) : strains.length === 0 ? (
          <p>{t("Protocol.noReference")}</p> // strains come with the reference data, after one sync online
        ) : placing ? (
          <PlacementForm
            houses={houses.map((h) => ({
              ...h,
              label: `${farms.get(h.farmId)?.name ?? ""} · ${h.name}`,
              busy: busy.has(h.id),
              open: batches.filter((b) => b.status === "open" && b.houseId === h.id),
            }))}
            downtime={{ batches, cleanouts: of<CleanoutDto>("cleanout"), rules: of<DowntimeRule>("downtimeRule") }}
            strains={strains.map((s) => ({ id: s.id, name: strainName(s.id), productionTypes: s.productionTypes ?? ["broiler"] }))}
            protocols={protocols}
            db={db}
            cashBoxes={can(scope, "finance.record") ? of<TreasuryAccountDto>("treasuryAccount").filter((a) => a.kind === "cash") : undefined} // SPEC-finance §9
            onPlaced={placed}
            onCancel={() => setPlacing(false)}
          />
        ) : (
          <button type="button" onClick={() => setPlacing(true)} className={primary}>{t("Batches.place")}</button>
        ))}
    </>
  );
}
