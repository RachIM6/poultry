"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { v7 as uuidv7 } from "uuid";
import { useFieldError, useInline } from "@/components/focus";
import { dataTable, dataTableWrap, formActions, num, sectionTitle } from "@/components/layout";
import { Scoped } from "@/components/scoped";
import { Sheet } from "@/components/sheet";
import { danger, done, field, ghost, primary, primarySm, secondarySm } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes, typedCentimes } from "@/lib/kernel/money";
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
// figure (§2, NQ4, SPEC-m2-compliance CQ3). tasks/plan-ui-cleanup.md: one table per farm, each house's batches in order;
// « Prévoir une bande » and « Saisir le vide sanitaire minimum » are the page header's actions, and every form (new plan,
// edit, placement, rule) opens in a sheet.

/** A cell shown from lg only: on the phone its content is in the row's « Bande » cell. */
const wide = "hidden lg:table-cell";

/** Into the page header's actions (the shell's `<span id="actions">`): the openers need the screen's data and state. */
function HeaderActions({ children }: { children: ReactNode }) {
  const slot = document.getElementById("actions");
  return slot && createPortal(children, slot);
}

export const PlanningScreen = () => <Scoped>{(scope) => <Planning {...scope} />}</Scoped>;

function Planning(scope: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb(scope);
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "plannedBatch", "downtimeRule", "protocol").toArray(), [scope.userId, scope.organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [message, setMessage] = useState<string>();
  // the open sheet: "add" or "downtime", or "place:<id>" (PL3) or "edit:<id>" (PL1), a plan's form
  const { open, opener, close } = useInline<string>();
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

  const rule = can(scope, "organization.manage");
  const sheetPlan = plans.find((p) => open === `place:${p.id}` || open === `edit:${p.id}`);
  const opens = (k: string) => ({ "aria-haspopup": "dialog" as const, ...opener(k) });
  return (
    <>
      {(manage || rule) && (
        <HeaderActions>
          {rule && <button type="button" {...opens("downtime")} className={secondarySm}>{t("Planning.enterDowntime")}</button>}
          {manage && houses.length > 0 && <button type="button" {...opens("add")} className={primarySm}>{t("Planning.add")}</button>}
        </HeaderActions>
      )}
      <Sheet
        open={(manage && (open === "add" || !!sheetPlan)) || (rule && open === "downtime")}
        onClose={close}
        title={
          open === "add" ? t("Planning.add")
          : open === "downtime" ? t("Planning.enterDowntime")
          : sheetPlan && t(open?.startsWith("place:") ? "Planning.place" : "Planning.edit", { date: day(sheetPlan.placeOn) })
        }
      >
        {open === "add" && <PlanForm houses={houses} strains={strains} today={today} onSave={(p) => savePlan(p).then(close)} onCancel={close} />}
        {open === "downtime" && <DowntimeForm farms={farms} today={today} onSave={(r) => write(P.saveDowntime, "downtimeRule", r).then(close)} onCancel={close} />}
        {sheetPlan && open?.startsWith("place:") && (
          <PlaceForm plan={sheetPlan} today={today} protocols={of<ProtocolDto>("protocol")} onSave={(batch, sent, protocol) => place(sheetPlan, batch, sent, protocol)} onCancel={close} />
        )}
        {sheetPlan && open?.startsWith("edit:") && <PlanForm plan={sheetPlan} houses={houses} strains={strains} today={today} onSave={(p) => savePlan(p).then(close)} onCancel={close} />}
      </Sheet>
      {message && <p role="status" className={done}>{t(message)}</p>}
      {farms.map((farm) => {
        const min = downtimeOn(rules, farm.id, today);
        return (
          <section key={farm.id} aria-label={farm.name} className="flex flex-col gap-2">
            {farms.length > 1 && <h2 className={sectionTitle}>{farm.name}</h2>}
            <p className="text-sm text-ink-2">{t("Planning.downtime", { days: String(min.minDays), source: min.source })}</p>
            <div className={dataTableWrap}>
              <table className={dataTable} aria-label={farm.name}>
                <thead>
                  <tr>
                    <th>{t("Planning.house")}</th>
                    <th>{t("Planning.colBatch")}</th>
                    <th className={wide}>{t("Planning.placeOn")}</th>
                    <th className={`${num} ${wide}`}>{t("Planning.chicks")}</th>
                    <th className={wide}>{t("Planning.hatchery")}</th>
                    <th className={wide}>{t("Planning.colSale")}</th>
                    {manage && <th><span className="sr-only">{t("Planning.colActions")}</span></th>}
                  </tr>
                </thead>
                {houses.filter((h) => h.farmId === farm.id).map((house) => {
                  const slots: Slot[] = [
                    ...batches.filter((b) => b.houseId === house.id).map((b) => {
                      const from = plans.find((p) => p.batchId === b.id); // the plan it was placed from knows its sale age
                      return { kind: "batch" as const, id: b.id, placeOn: b.placedOn, saleDay: from ? saleDay(b.placedOn, from.saleAge) : null };
                    }),
                    ...plans.filter((p) => p.houseId === house.id && p.status === "planned").map((p) => ({ kind: "plan" as const, id: p.id, placeOn: p.placeOn, saleDay: saleDay(p.placeOn, p.saleAge) })),
                  ];
                  const lines = houseTimeline(slots, min.minDays);
                  const name = <th scope="rowgroup" rowSpan={Math.max(lines.length, 1)} className="align-top font-semibold">{house.name}</th>;
                  return (
                    <tbody key={house.id} aria-label={t("Planning.of", { house: house.name })}>
                      {lines.length === 0 ? (
                        <tr>
                          {name}
                          <td colSpan={manage ? 6 : 5} className="text-ink-2">{t("Planning.empty")}</td>
                        </tr>
                      ) : (
                        lines.map((line, i) => {
                          const plan = plans.find((p) => p.id === line.id);
                          const batch = batches.find((b) => b.id === line.id);
                          const [chicks, hatchery] = plan ? [plan.chicks, plan.hatchery] : [batch?.chicksPlaced, batch?.hatchery];
                          const sale = line.saleDay ? day(line.saleDay) : t("Planning.saleUnknown");
                          return (
                            <tr key={line.id}>
                              {i === 0 && name}
                              <td>
                                {line.gapDays !== null && line.gapDays >= 0 && <span className="block text-[13px] text-ink-2">{t("Planning.gap", { days: String(line.gapDays) })}</span>}
                                <span className="font-medium">{t(line.kind === "batch" ? "Planning.stateBatch" : "Planning.statePlan")}</span>
                                {/* the phone: the plan's figures under its state */}
                                <span className="block text-ink-2 lg:hidden">
                                  {line.kind === "batch" ? t("Planning.batch", { date: day(line.placeOn) }) : t("Planning.plan", { date: day(line.placeOn), chicks: String(chicks ?? 0), hatchery: hatchery ?? "" })}
                                </span>
                                <span className="block text-ink-2 lg:hidden">{line.saleDay ? t("Planning.sale", { date: sale }) : sale}</span>
                                {line.overlaps && <span role="note" className="block text-sm font-medium text-brick-fg">{t("Planning.overlaps")}</span>}
                                {line.shortDowntime && <span role="note" className="block text-sm font-medium text-brick-fg">{t("Planning.short", { days: String(min.minDays) })}</span>}
                              </td>
                              <td className={`whitespace-nowrap ${wide}`}>{day(line.placeOn)}</td>
                              <td className={`${num} ${wide}`}>{chicks === undefined ? "" : String(chicks)}</td>
                              <td className={wide}>{hatchery}</td>
                              <td className={`whitespace-nowrap ${wide}`}>{sale}</td>
                              {manage && (
                                <td>
                                  {plan && (
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                      {plan.placeOn <= nextFarmDay(today) && (
                                        <button type="button" {...opens(`place:${plan.id}`)} aria-label={t("Planning.place", { date: day(plan.placeOn) })} className={primarySm}>{t("Planning.placeSave")}</button>
                                      )}
                                      <button type="button" {...opens(`edit:${plan.id}`)} aria-label={t("Planning.edit", { date: day(plan.placeOn) })} className={secondarySm}>{t("Planning.editShort")}</button>
                                      <button type="button" onClick={() => write(P.cancelPlan, "plannedBatch", { ...plan, status: "cancelled" }, { id: plan.id })} aria-label={t("Planning.cancel", { date: day(plan.placeOn) })} className={`${ghost} min-w-11`}>
                                        {t("Planning.cancelShort")}
                                      </button>
                                    </div>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  );
                })}
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

type Strain = { id: string; name: string };
const priceText = (centimes: string | null | undefined) => (centimes ? typedCentimes(BigInt(centimes)) : "");

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
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label={t("Planning.place", { date: formatDay(plan.placeOn as FarmDay, locale) })}>
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
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <div className={formActions}>
        <button type="submit" className={primary}>{t("Planning.placeSave")}</button>
        <button type="button" onClick={onCancel} className={`${ghost} min-w-11`}>{t("Batches.cancel")}</button>
      </div>
    </form>
  );
}

/** PL1: a new plan, or an edit of a planned one (the same form, prefilled). */
function PlanForm({ plan, houses, strains, today, onSave, onCancel }: { plan?: PlanDto; houses: HouseDto[]; strains: readonly Strain[]; today: string; onSave: (p: PlanDto) => Promise<unknown>; onCancel: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const [error, setError] = useState<string>();
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
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label={plan ? t("Planning.edit", { date: formatDay(plan.placeOn as FarmDay, locale) }) : t("Planning.add")}>
      <label htmlFor={id.house}>{t("Planning.house")}</label>
      <select id={id.house} name="house" defaultValue={plan?.houseId} className={field}>
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
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <div className={formActions}>
        <button type="submit" className={primary}>{t("Planning.save")}</button>
        <button type="button" onClick={onCancel} className={`${ghost} min-w-11`}>{t("Batches.cancel")}</button>
      </div>
    </form>
  );
}

function DowntimeForm({ farms, today, onSave, onCancel }: { farms: FarmDto[]; today: string; onSave: (r: DowntimeRule) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  const id = { farm: useId(), days: useId(), source: useId(), from: useId() };
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const rule = { id: uuidv7(), farmId: String(data.get("farm")), validFrom: String(data.get("from")), minDays: Number(data.get("days")), source: String(data.get("source")).trim() };
    const checked = checkDowntimeRule(rule); // the server refuses it too
    if (!checked.ok) return setError(`errors.${checked.error}`, ev.currentTarget, "days");
    setError(undefined);
    await onSave(rule);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label={t("Planning.enterDowntime")}>
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
      <input id={id.days} name="days" type="number" min={OFFICIAL_DOWNTIME.minDays} max={365} required autoFocus={farms.length === 1} {...bad("days")} className={field} />
      <label htmlFor={id.source}>{t("Pay.source")}</label>
      <input id={id.source} name="source" required minLength={3} maxLength={300} className={field} />
      <label htmlFor={id.from}>{t("Pay.validFrom")}</label>
      <input id={id.from} name="from" type="date" required defaultValue={today} className={field} />
      {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
      <div className={formActions}>
        <button type="submit" className={primary}>{t("Planning.saveDowntime")}</button>
        <button type="button" onClick={onCancel} className={`${ghost} min-w-11`}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
