"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatCount } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import { Batch, FLOCK_MUTATIONS as M, ageOn, type BatchCostDto, type BatchDto, type DailyEntryDto, type SoldBirdsDto, type WeighingDto } from "@/modules/flock/shared";
import { HEALTH_MUTATIONS as H, planFor, withdrawalUntil, type TreatmentDto, type VaccinationDto, type VetVisitDto } from "@/modules/health/shared";
import type { StockItemDto } from "@/modules/inventory/shared";
import type { ProtocolDto } from "@/modules/reference-data/schema";
import type { BuyerDto, SaleDto } from "@/modules/sales/shared";
import dynamic from "next/dynamic";
import { DayForm, type Write } from "@/components/daily-entry";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";
import { BatchStrip, stripDays } from "@/components/batch-strip";
import { card, field, primary, secondary } from "@/components/ui";

// SPEC §9.3 budget (ADR-009, T25): the day's entry loads with the page; the rest of the batch screen comes in its own
// chunks right after. The service worker precaches every chunk, so they load offline too.
const BatchDashboard = dynamic(() => import("@/components/batch-dashboard").then((m) => m.BatchDashboard));
const BatchCosts = dynamic(() => import("@/components/closing").then((m) => m.BatchCosts));
const CloseBatchForm = dynamic(() => import("@/components/closing").then((m) => m.CloseBatchForm));
const ClosedSummary = dynamic(() => import("@/components/closing").then((m) => m.ClosedSummary));
const Sales = dynamic(() => import("@/components/sales").then((m) => m.Sales));
const Treatments = dynamic(() => import("@/components/treatments").then((m) => m.Treatments));
const VetVisits = dynamic(() => import("@/components/treatments").then((m) => m.VetVisits));
const WithdrawalBanner = dynamic(() => import("@/components/treatments").then((m) => m.WithdrawalBanner));
const Vaccinations = dynamic(() => import("@/components/vaccinations").then((m) => m.Vaccinations));
const Weighings = dynamic(() => import("@/components/weighing").then((m) => m.Weighings));
const BatchHeader = dynamic(() => import("@/components/batch-dashboard").then((m) => m.BatchHeader));
const OpenBatchCard = dynamic(() => import("@/components/batch-dashboard").then((m) => m.OpenBatchCard));

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
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "dailyEntry", "weighing", "stockItem", "protocol", "vaccination", "treatment", "vetVisit", "soldBirds", "buyer", "sale", "batchCost").toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState<string>();
  const openId = useHash();
  if (!records || reference === undefined) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const farms = new Map(of<FarmDto>("farm").map((f) => [f.id, f]));
  const houses = of<HouseDto>("house");
  const openFirst = (b: BatchDto) => (b.status === "open" ? 0 : 1);
  const batches = of<BatchDto>("batch").sort((x, y) => openFirst(x) - openFirst(y) || y.placedOn.localeCompare(x.placedOn));
  const strains = reference?.data.strains ?? [];
  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? "";
  const busy = new Set(batches.filter((b) => b.status === "open").map((b) => b.houseId));
  const entries = of<DailyEntryDto>("dailyEntry");
  const entriesOf = (batchId: string) => entries.filter((e) => e.batchId === batchId);
  const soldOf = (batchId: string) => of<SoldBirdsDto>("soldBirds").filter((s) => s.batchId === batchId);
  const soldBirds = (batchId: string) => soldOf(batchId).reduce((n, s) => n + s.birds, 0); // B5
  const onHand = (b: BatchDto) => b.chicksPlaced - b.deadOnArrival - soldBirds(b.id) - entriesOf(b.id).reduce((n, e) => n + e.dead + e.culled, 0);

  // tasks/plan-ui.md U4: the 42-day strip on each card and on the batch page (Batch.dc.html).
  const vaccinationsOf = (batchId: string) => of<VaccinationDto>("vaccination").filter((v) => v.batchId === batchId);
  const stripOf = (b: BatchDto) => {
    const its = of<TreatmentDto>("treatment").filter((x) => x.batchId === b.id);
    const until = withdrawalUntil(its.map((x) => ({ ...x, startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay })), today());
    const from = its.filter((x) => x.withdrawalEndsOn >= today()).map((x) => x.startOn).sort()[0];
    const age = ageOn(b.placedOn as FarmDay, today());
    const days = stripDays({
      placedOn: b.placedOn as FarmDay,
      today: today(),
      age,
      entered: new Set(entriesOf(b.id).map((e) => e.day)),
      vaccineDays: vaccinationsOf(b.id).filter((v) => !v.done).map((v) => v.dueOn),
      withdrawal: until && from ? { from: from as FarmDay, to: until } : null,
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
  const nextVaccine = (batchId: string) => {
    const v = vaccinationsOf(batchId).filter((x) => !x.done).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
    if (!v) return null;
    const p = reference?.data.products.find((x) => x.id === v.productId);
    return `${p ? (locale === "ar" ? p.nameAr : p.nameFr) : v.productId} · ${t("Batches.age", { age: String(v.dayOfAge) })}`;
  };
  const title = (b: BatchDto) => t("Batches.summary", { farm: farms.get(b.farmId)?.name ?? "", house: houseName(b.houseId), strain: strains.find((s) => s.id === b.strainId)?.name ?? b.strainId });
  const costsOf = (batchId: string) => of<BatchCostDto>("batchCost").filter((c) => c.batchId === batchId);
  const salesOf = (batchId: string) => of<SaleDto>("sale").filter((s) => s.batchId === batchId);
  if (shown?.status === "closed") {
    // B6: read-only, with the locked figures; its sales stay listed for their origin documents (V5).
    const curve = strains.find((s) => s.id === shown.strainId)?.curves.at(-1)?.points ?? null;
    return (
      <>
        <BatchHeader title={title(shown)} />
        {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
        <ClosedSummary batch={shown} />
        <BatchDashboard batch={shown} entries={entriesOf(shown.id)} weighings={of<WeighingDto>("weighing").filter((w) => w.batchId === shown.id)} sold={soldOf(shown.id)} curve={curve} />
        <BatchCosts batch={shown} costs={costsOf(shown.id)} manage={can(scope, "flock.manage")} write={write} />
        {can(scope, "sales.manage") && <Sales batch={shown} sales={salesOf(shown.id)} buyers={of<BuyerDto>("buyer")} treatments={[]} birdsOnHand={0} write={write} />}
      </>
    );
  }

  const open = shown;
  if (open) {
    const weighings = of<WeighingDto>("weighing").filter((w) => w.batchId === open.id);
    const curve = strains.find((s) => s.id === open.strainId)?.curves.at(-1)?.points ?? null; // latest version (OQ5)
    const treatments = of<TreatmentDto>("treatment").filter((x) => x.batchId === open.id);
    return (
      <>
        <BatchHeader title={title(open)} />
        <OpenBatchCard strip={stripOf(open)} birds={t("Day.onHand", { birds: formatCount(onHand(open)) })} next={nextVaccine(open.id)} />
        <WithdrawalBanner treatments={treatments} />
        {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
        <BatchDashboard batch={open} entries={entriesOf(open.id)} weighings={weighings} sold={soldOf(open.id)} curve={curve} />
        <DayForm
          batch={open}
          entries={entriesOf(open.id)}
          soldBirds={soldBirds(open.id)}
          feedItems={of<StockItemDto>("stockItem").filter((i) => i.farmId === open.farmId && i.kind === "feed")}
          write={write}
        />
        <Weighings
          batch={open}
          weighings={weighings}
          curve={curve}
          write={write}
        />
        <Vaccinations
          batch={open}
          vaccinations={of<VaccinationDto>("vaccination").filter((v) => v.batchId === open.id)}
          products={reference?.data.products ?? []}
          lots={of<StockItemDto>("stockItem").filter((i) => i.farmId === open.farmId && i.kind === "vaccine")}
          birdsOnHand={onHand(open)}
          userId={userId}
          write={write}
        />
        <Treatments
          batch={open}
          treatments={treatments}
          medicines={of<StockItemDto>("stockItem").filter((i) => i.farmId === open.farmId && i.kind === "medicine")}
          userId={userId}
          write={write}
        />
        <VetVisits batch={open} visits={of<VetVisitDto>("vetVisit").filter((v) => v.batchId === open.id)} userId={userId} write={write} />
        {can(scope, "sales.manage") && (
          <Sales
            batch={open}
            sales={salesOf(open.id)}
            buyers={of<BuyerDto>("buyer")}
            treatments={treatments}
            birdsOnHand={onHand(open)}
            write={write}
          />
        )}
        <BatchCosts batch={open} costs={costsOf(open.id)} manage={can(scope, "flock.manage")} write={write} />
        {can(scope, "flock.manage") && <CloseBatchForm batch={open} write={write} />}
      </>
    );
  }

  const protocols = of<ProtocolDto>("protocol").sort((x, y) => x.name.localeCompare(y.name));
  const save = async (batch: BatchDto, payload: unknown, protocol: ProtocolDto | undefined) => {
    try {
      await writeLocal(db, { type: M.placeBatch, payload }, [{ entity: "batch", id: batch.id, data: batch }]);
      if (protocol && protocol.items.length > 0) {
        // H1: the plan from the farm's protocol, queued right after the placement it belongs to
        const plan = planFor(batch.id, batch.placedOn as FarmDay, protocol.items);
        const items = protocol.items;
        await writeLocal(db, { type: H.planVaccinations, payload: { batchId: batch.id, protocolId: protocol.id, items } }, plan.map((v) => ({ entity: "vaccination", id: v.id, data: v })));
      }
      setMessage("Farms.saved");
      setPlacing(false);
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    }
  };

  return (
    <>
      {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
      {batches.length === 0 ? (
        <p>{t("Batches.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((b) => (
            <li key={b.id} className={card}>
              <span className="font-semibold">
                {b.status === "open" ? t("Batches.age", { age: String(ageOn(b.placedOn as FarmDay, today())) }) : t("Batches.status.closed")}
              </span>
              {b.status === "open" && <BatchStrip {...stripOf(b)} />}
              <span>
                {t("Batches.summary", { farm: farms.get(b.farmId)?.name ?? "", house: houseName(b.houseId), strain: strains.find((s) => s.id === b.strainId)?.name ?? b.strainId })}
              </span>
              <span className="text-sm text-muted">{t("Batches.chicks", { chicks: formatCount(b.chicksPlaced), doa: formatCount(b.deadOnArrival) })}</span>
              <span>{t("Day.onHand", { birds: formatCount(onHand(b)) })}</span>
              {b.status === "open" ? (
                <a href={`#${b.id}`} className={`${primary} mt-2`}>{t("Day.open")}</a>
              ) : (
                <a href={`#${b.id}`} className="py-2 underline underline-offset-4">{t("Closing.open")}</a>
              )}
            </li>
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
            houses={houses.map((h) => ({ ...h, label: `${farms.get(h.farmId)?.name ?? ""} · ${h.name}`, busy: busy.has(h.id) }))}
            strains={strains}
            protocols={protocols}
            onSave={save}
            onCancel={() => setPlacing(false)}
          />
        ) : (
          <button type="button" onClick={() => setPlacing(true)} className={primary}>{t("Batches.place")}</button>
        ))}
    </>
  );
}

function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={field} {...input} />
    </div>
  );
}

function Select({ label, name, children }: { label: string; name: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} className={field}>{children}</select>
    </div>
  );
}

function PlacementForm({
  houses,
  strains,
  protocols,
  onSave,
  onCancel,
}: {
  houses: (HouseDto & { label: string; busy: boolean })[];
  strains: { id: string; name: string }[];
  protocols: ProtocolDto[];
  onSave: (batch: BatchDto, payload: unknown, protocol: ProtocolDto | undefined) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const house = houses.find((h) => h.id === get("houseId"));
    const price = parseCentimes(get("price") || "0");
    const int = (k: string) => (/^\d+$/.test(get(k)) ? Number(get(k)) : NaN);
    if (!house || price === null || !get("hatchery") || !get("deliveryNote")) return setError("Batches.invalid");
    if (house.busy) return setError("errors.HOUSE_HAS_OPEN_BATCH"); // the server enforces it too

    const placement = {
      id: uuidv7(),
      farmId: house.farmId,
      houseId: house.id,
      strainId: get("strainId"),
      placedOn: (get("placedOn") || today()) as FarmDay,
      chicksPlaced: int("chicksPlaced"),
      deadOnArrival: get("deadOnArrival") ? int("deadOnArrival") : 0,
      hatchery: get("hatchery"),
      deliveryNote: get("deliveryNote"),
      chickUnitPriceCentimes: price,
      dayOldWeightGrams: get("dayOldWeight") ? int("dayOldWeight") : null,
    };
    const batch = Batch.place(placement, today()); // the same rules as the server
    if (!batch.ok) return setError(batch.error === "INVALID_QUANTITY" ? "Batches.invalid" : `errors.${batch.error}`);
    setError(undefined);

    const sent = { ...placement, chickUnitPriceCentimes: String(price) }; // farmId is dropped by the schema: the server derives it
    await onSave({ ...sent, species: "broiler", status: "open" }, sent, protocols.find((p) => p.id === get("protocolId")));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-3">
      <Select label={t("Batches.house")} name="houseId">
        {houses.map((h) => (
          <option key={h.id} value={h.id}>{h.busy ? t("Batches.houseBusy", { house: h.label }) : h.label}</option>
        ))}
      </Select>
      <Select label={t("Batches.strain")} name="strainId">
        {strains.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      {protocols.length > 0 && (
        <Select label={t("Batches.protocol")} name="protocolId">
          {protocols.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="">{t("Batches.noProtocol")}</option>
        </Select>
      )}
      <Field name="placedOn" label={t("Batches.placedOn")} type="date" defaultValue={today()} required />
      <Field name="chicksPlaced" label={t("Batches.chicksPlaced")} inputMode="numeric" pattern="\d+" required dir="ltr" />
      <Field name="deadOnArrival" label={t("Batches.deadOnArrival")} inputMode="numeric" pattern="\d+" defaultValue="0" dir="ltr" />
      <Field name="hatchery" label={t("Batches.hatchery")} required maxLength={120} />
      <Field name="deliveryNote" label={t("Batches.deliveryNote")} required maxLength={60} dir="ltr" />
      <Field name="price" label={t("Batches.chickPrice")} inputMode="decimal" required dir="ltr" />
      <Field name="dayOldWeight" label={t("Batches.dayOldWeight")} inputMode="numeric" pattern="\d+" dir="ltr" />
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Batches.save")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Batches.cancel")}</button>
      </div>
    </form>
  );
}

