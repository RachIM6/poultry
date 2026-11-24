"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { useInline } from "@/components/focus";
import { Scoped } from "@/components/scoped";
import { card, done, field, primary, secondary } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto } from "@/modules/flock/schema";
import { HEALTH_MUTATIONS as H, planFor } from "@/modules/health/shared";
import { checkDowntimeRule, downtimeOn, houseTimeline, OFFICIAL_DOWNTIME, PLANNING_MUTATIONS as P, saleDay, type DowntimeRule, type PlanDto, type Slot } from "@/modules/planning/shared";
import type { ProtocolDto } from "@/modules/reference-data/schema";
import { cachedReference, localDb, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";

// SPEC-m5 PL1, PL2, PL5 on the static /planning shell, offline: each house's open batch and planned batches in
// order, the gaps between them, and the warnings. The minimum downtime is the official 20 days or the owner's higher
// figure (§2, NQ4, SPEC-m2-compliance CQ3).

export const PlanningScreen = () => <Scoped>{(scope) => <Planning {...scope} />}</Scoped>;

function Planning(scope: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb(scope);
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "plannedBatch", "downtimeRule", "protocol").toArray(), [scope.userId, scope.organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [message, setMessage] = useState<string>();
  const { open, opener, close } = useInline<string>(); // "place:<id>" (PL3) or "edit:<id>" (PL1), the plan's form
  if (!records) return null;
  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const farms = of<FarmDto>("farm");
  const houses = of<HouseDto>("house");
  const batches = of<BatchDto>("batch").filter((b) => b.status === "open");
  const plans = of<PlanDto>("plannedBatch");
  const rules = of<DowntimeRule>("downtimeRule");
  const strains = reference?.data.strains ?? [];
  const today = farmDayOf(new Date());
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const manage = can(scope, "flock.manage");
  if (farms.length === 0) return <p>{t("Farms.none")}</p>;

  const write = async <T extends { id: string }>(type: string, entity: string, data: T, payload: object = data) => {
    try {
      await writeLocal(db, { type, payload }, { entity, id: data.id, data });
      setMessage("Farms.saved");
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    }
  };
  // PL1: created, or edited while planned; the server takes the whole plan again.
  const savePlan = (p: PlanDto) => write(P.savePlan, "plannedBatch", p, { id: p.id, houseId: p.houseId, placeOn: p.placeOn, chicks: p.chicks, strainId: p.strainId, hatchery: p.hatchery, chickPriceCentimes: p.chickPriceCentimes ?? null, saleAge: p.saleAge });

  // PL3: one mutation places the batch and marks the plan; the vaccination plan follows, as on /batches (H1).
  const place = async (plan: PlanDto, batch: BatchDto, sent: object, protocol: ProtocolDto | undefined) => {
    try {
      await writeLocal(db, { type: P.placeFromPlan, payload: { planId: plan.id, batch: sent } }, [
        { entity: "batch", id: batch.id, data: batch },
        { entity: "plannedBatch", id: plan.id, data: { ...plan, status: "placed", batchId: batch.id } },
      ]);
      if (protocol && protocol.items.length > 0) {
        const vaccinations = planFor(batch.id, batch.placedOn as FarmDay, protocol.items);
        await writeLocal(db, { type: H.planVaccinations, payload: { batchId: batch.id, protocolId: protocol.id, items: protocol.items } }, vaccinations.map((v) => ({ entity: "vaccination", id: v.id, data: v })));
      }
      setMessage("Farms.saved");
      close();
    } catch {
      setMessage("Farms.saveFailed");
    }
  };

  return (
    <>
      {message && <p role="status" className={done}>{t(message)}</p>}
      {farms.map((farm) => {
        const min = downtimeOn(rules, farm.id, today);
        return (
          <section key={farm.id} aria-label={farm.name} className="flex flex-col gap-3">
            {farms.length > 1 && <h2 className="text-[17px] font-semibold text-ink-2">{farm.name}</h2>}
            <p className="text-[13px] text-ink-2">{t("Planning.downtime", { days: String(min.minDays), source: min.source })}</p>
            {houses.filter((h) => h.farmId === farm.id).map((house) => {
              const slots: Slot[] = [
                ...batches.filter((b) => b.houseId === house.id).map((b) => {
                  const from = plans.find((p) => p.batchId === b.id); // the plan it was placed from knows its sale age
                  return { kind: "batch" as const, id: b.id, placeOn: b.placedOn, saleDay: from ? saleDay(b.placedOn, from.saleAge) : null };
                }),
                ...plans.filter((p) => p.houseId === house.id && p.status === "planned").map((p) => ({ kind: "plan" as const, id: p.id, placeOn: p.placeOn, saleDay: saleDay(p.placeOn, p.saleAge) })),
              ];
              return (
                <div key={house.id} className={card}>
                  <h3 className="font-semibold">{house.name}</h3>
                  {slots.length === 0 ? (
                    <p className="text-ink-2">{t("Planning.empty")}</p>
                  ) : (
                    <ol aria-label={t("Planning.of", { house: house.name })} className="flex flex-col gap-2">
                      {houseTimeline(slots, min.minDays).map((line) => {
                        const plan = plans.find((p) => p.id === line.id);
                        return (
                          <li key={line.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                            {line.gapDays !== null && line.gapDays >= 0 && <span className="block text-[13px] text-ink-2">{t("Planning.gap", { days: String(line.gapDays) })}</span>}
                            <span className="block">
                              {line.kind === "batch" ? t("Planning.batch", { date: day(line.placeOn) }) : t("Planning.plan", { date: day(line.placeOn), chicks: String(plan?.chicks ?? 0), hatchery: plan?.hatchery ?? "" })}
                            </span>
                            <span className="block text-sm text-ink-2">{line.saleDay ? t("Planning.sale", { date: day(line.saleDay) }) : t("Planning.saleUnknown")}</span>
                            {line.overlaps && <span role="note" className="block text-sm font-medium text-brick-fg">{t("Planning.overlaps")}</span>}
                            {line.shortDowntime && <span role="note" className="block text-sm font-medium text-brick-fg">{t("Planning.short", { days: String(min.minDays) })}</span>}
                            {plan && manage && open === `place:${plan.id}` && (
                              <PlaceForm plan={plan} today={today} protocols={of<ProtocolDto>("protocol")} onSave={(batch, sent, protocol) => place(plan, batch, sent, protocol)} onCancel={close} />
                            )}
                            {plan && manage && open === `edit:${plan.id}` && (
                              <PlanForm plan={plan} houses={houses} strains={strains} today={today} onSave={(p) => savePlan(p).then(close)} onCancel={close} />
                            )}
                            {plan && manage && !open?.endsWith(plan.id) && (
                              <span className="mt-2 flex flex-wrap gap-2">
                                {plan.placeOn <= nextFarmDay(today) && (
                                  <button type="button" {...opener(`place:${plan.id}`)} className={primary}>{t("Planning.place", { date: day(plan.placeOn) })}</button>
                                )}
                                <button type="button" {...opener(`edit:${plan.id}`)} className={secondary}>{t("Planning.edit", { date: day(plan.placeOn) })}</button>
                                <button type="button" onClick={() => write(P.cancelPlan, "plannedBatch", { ...plan, status: "cancelled" }, { id: plan.id })} className={secondary}>
                                  {t("Planning.cancel", { date: day(plan.placeOn) })}
                                </button>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {manage && <PlanForm houses={houses} strains={strains} today={today} onSave={savePlan} />}
      {can(scope, "organization.manage") && <DowntimeForm farms={farms} today={today} onSave={(r) => write(P.saveDowntime, "downtimeRule", r)} />}
    </>
  );
}

type Strain = { id: string; name: string };
const priceText = (centimes: string | null | undefined) => (centimes ? `${BigInt(centimes) / 100n},${String(BigInt(centimes) % 100n).padStart(2, "0")}` : "");

/** PL3: the placement, filled from the plan; what only the delivery says (dead on arrival, delivery note) is asked here. */
function PlaceForm({ plan, today, protocols, onSave, onCancel }: { plan: PlanDto; today: string; protocols: ProtocolDto[]; onSave: (batch: BatchDto, sent: object, protocol: ProtocolDto | undefined) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const [error, setError] = useState<string>();
  const id = { day: useId(), chicks: useId(), dead: useId(), note: useId(), price: useId(), weight: useId(), protocol: useId() };
  const price = priceText(plan.chickPriceCentimes);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const int = (k: string) => (/^\d+$/.test(get(k)) ? Number(get(k)) : NaN);
    const centimes = parseCentimes(get("price"));
    const [chicks, dead, weight] = [int("chicks"), get("dead") ? int("dead") : 0, get("weight") ? int("weight") : null];
    if (centimes === null || !get("note") || !(chicks > 0) || Number.isNaN(dead) || (weight !== null && !(weight > 0))) return setError("Batches.invalid");
    setError(undefined);
    const sent = { id: uuidv7(), houseId: plan.houseId, strainId: plan.strainId, placedOn: get("day"), chicksPlaced: chicks, deadOnArrival: dead, hatchery: plan.hatchery, deliveryNote: get("note"), chickUnitPriceCentimes: String(centimes), dayOldWeightGrams: weight };
    await onSave({ ...sent, farmId: plan.farmId, species: "broiler", status: "open" }, sent, protocols.find((p) => p.id === get("protocol")));
  };
  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2 rounded-2xl border border-line p-3" aria-label={t("Planning.place", { date: formatDay(plan.placeOn as FarmDay, locale) })}>
      <label htmlFor={id.day}>{t("Batches.placedOn")}</label>
      <input id={id.day} name="day" type="date" required max={nextFarmDay(today as FarmDay)} defaultValue={plan.placeOn <= today ? today : plan.placeOn} autoFocus className={field} />
      <label htmlFor={id.chicks}>{t("Batches.chicksPlaced")}</label>
      <input id={id.chicks} name="chicks" inputMode="numeric" dir="ltr" required defaultValue={String(plan.chicks)} className={field} />
      <label htmlFor={id.dead}>{t("Batches.deadOnArrival")}</label>
      <input id={id.dead} name="dead" inputMode="numeric" dir="ltr" defaultValue="0" className={field} />
      <label htmlFor={id.note}>{t("Batches.deliveryNote")}</label>
      <input id={id.note} name="note" required maxLength={60} dir="ltr" className={field} />
      <label htmlFor={id.price}>{t("Batches.chickPrice")}</label>
      <input id={id.price} name="price" inputMode="decimal" dir="ltr" required defaultValue={price} className={field} />
      <label htmlFor={id.weight}>{t("Batches.dayOldWeight")}</label>
      <input id={id.weight} name="weight" inputMode="numeric" dir="ltr" className={field} />
      {protocols.length > 0 && (
        <>
          <label htmlFor={id.protocol}>{t("Batches.protocol")}</label>
          <select id={id.protocol} name="protocol" className={field}>
            {protocols.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="">{t("Batches.noProtocol")}</option>
          </select>
        </>
      )}
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Planning.placeSave")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Batches.cancel")}</button>
      </div>
    </form>
  );
}

/** PL1: a new plan, or an edit of a planned one (the same form, prefilled). */
function PlanForm({ plan, houses, strains, today, onSave, onCancel }: { plan?: PlanDto; houses: HouseDto[]; strains: readonly Strain[]; today: string; onSave: (p: PlanDto) => Promise<unknown>; onCancel?: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const [error, setError] = useState<string>();
  const [key, setKey] = useState(0); // a new key empties the form after a save
  const id = { house: useId(), day: useId(), chicks: useId(), strain: useId(), hatchery: useId(), price: useId(), age: useId() };
  if (houses.length === 0) return null;
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const price = get("price") === "" ? null : parseCentimes(get("price"));
    const chicks = Number(get("chicks"));
    const age = get("age") === "" ? null : Number(get("age"));
    if ((get("price") !== "" && price === null) || !Number.isInteger(chicks) || chicks <= 0 || (age !== null && !(Number.isInteger(age) && age >= 1 && age <= 800))) return setError("errors.INVALID_QUANTITY");
    setError(undefined);
    const house = houses.find((h) => h.id === get("house"))!;
    await onSave({ id: plan?.id ?? uuidv7(), farmId: house.farmId, houseId: house.id, placeOn: get("day"), chicks, strainId: get("strain"), hatchery: get("hatchery"), chickPriceCentimes: price === null ? null : String(price), saleAge: age, status: "planned", batchId: null });
    setKey((k) => k + 1);
  };
  return (
    <form
      key={key}
      onSubmit={submit}
      className={plan ? "mt-2 flex flex-col gap-2 rounded-2xl border border-line p-3" : card}
      aria-label={plan ? t("Planning.edit", { date: formatDay(plan.placeOn as FarmDay, locale) }) : t("Planning.add")}
    >
      <label htmlFor={id.house}>{t("Planning.house")}</label>
      <select id={id.house} name="house" defaultValue={plan?.houseId} autoFocus={!!plan} className={field}>
        {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      <label htmlFor={id.day}>{t("Planning.placeOn")}</label>
      {/* an overdue plan keeps its day; no earlier one */}
      <input id={id.day} name="day" type="date" required min={plan && plan.placeOn < today ? plan.placeOn : today} defaultValue={plan?.placeOn} className={field} />
      <label htmlFor={id.chicks}>{t("Planning.chicks")}</label>
      <input id={id.chicks} name="chicks" inputMode="numeric" dir="ltr" required defaultValue={plan ? String(plan.chicks) : undefined} className={field} />
      <label htmlFor={id.strain}>{t("Planning.strain")}</label>
      <select id={id.strain} name="strain" required defaultValue={plan?.strainId} className={field}>
        {strains.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <label htmlFor={id.hatchery}>{t("Planning.hatchery")}</label>
      <input id={id.hatchery} name="hatchery" required maxLength={120} defaultValue={plan?.hatchery} className={field} />
      <label htmlFor={id.price}>{t("Planning.price")}</label>
      <input id={id.price} name="price" inputMode="decimal" dir="ltr" defaultValue={priceText(plan?.chickPriceCentimes)} className={field} />
      <label htmlFor={id.age}>{t("Planning.saleAge")}</label>
      <input id={id.age} name="age" inputMode="numeric" dir="ltr" defaultValue={plan?.saleAge ?? ""} className={field} />
      {error && <p role="alert">{t(error)}</p>}
      {onCancel ? (
        <div className="flex gap-3">
          <button type="submit" className={primary}>{t("Planning.save")}</button>
          <button type="button" onClick={onCancel} className={secondary}>{t("Batches.cancel")}</button>
        </div>
      ) : (
        <button type="submit" className={primary}>{t("Planning.save")}</button>
      )}
    </form>
  );
}

function DowntimeForm({ farms, today, onSave }: { farms: FarmDto[]; today: string; onSave: (r: DowntimeRule) => Promise<void> }) {
  const t = useTranslations();
  const { open, opener, close } = useInline<"downtime">();
  const [error, setError] = useState<string>();
  const id = { farm: useId(), days: useId(), source: useId(), from: useId() };
  if (!open) return <button type="button" {...opener("downtime")} className={secondary}>{t("Planning.enterDowntime")}</button>;
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const rule = { id: uuidv7(), farmId: String(data.get("farm")), validFrom: String(data.get("from")), minDays: Number(data.get("days")), source: String(data.get("source")).trim() };
    const checked = checkDowntimeRule(rule); // the server refuses it too
    if (!checked.ok) return setError(`errors.${checked.error}`);
    setError(undefined);
    await onSave(rule);
    close();
  };
  return (
    <form onSubmit={submit} className={card} aria-label={t("Planning.enterDowntime")}>
      <p className="text-sm text-ink-2">{t("Planning.downtimeHint")}</p>
      {farms.length > 1 && (
        <>
          <label htmlFor={id.farm}>{t("Staff.farm")}</label>
          <select id={id.farm} name="farm" autoFocus className={field}>
            {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </>
      )}
      {farms.length === 1 && <input type="hidden" name="farm" value={farms[0].id} />}
      <label htmlFor={id.days}>{t("Planning.minDays")}</label>
      <input id={id.days} name="days" type="number" min={OFFICIAL_DOWNTIME.minDays} max={365} required autoFocus={farms.length === 1} className={field} />
      <label htmlFor={id.source}>{t("Pay.source")}</label>
      <input id={id.source} name="source" required minLength={3} maxLength={300} className={field} />
      <label htmlFor={id.from}>{t("Pay.validFrom")}</label>
      <input id={id.from} name="from" type="date" required defaultValue={today} className={field} />
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Planning.saveDowntime")}</button>
        <button type="button" onClick={close} className={secondary}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
