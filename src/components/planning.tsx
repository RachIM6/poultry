"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { Scoped } from "@/components/scoped";
import { card, done, field, primary, secondary } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto } from "@/modules/flock/schema";
import { downtimeOn, houseTimeline, PLANNING_MUTATIONS as P, saleDay, type DowntimeRule, type PlanDto, type Slot } from "@/modules/planning/shared";
import { cachedReference, localDb, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";

// SPEC-m5 PL1, PL2, PL5 on the static /planning shell, offline: each house's open batch and planned batches in
// order, the gaps between them, and the warnings. The minimum downtime is the owner's figure (§2, NQ4).

export const PlanningScreen = () => <Scoped>{(scope) => <Planning {...scope} />}</Scoped>;

function Planning(scope: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb(scope);
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "plannedBatch", "downtimeRule").toArray(), [scope.userId, scope.organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [message, setMessage] = useState<string>();
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

  return (
    <>
      {message && <p role="status" className={done}>{t(message)}</p>}
      {farms.map((farm) => {
        const min = downtimeOn(rules, farm.id, today);
        const rule = rules.filter((r) => r.farmId === farm.id && r.validFrom <= today).sort((x, y) => y.validFrom.localeCompare(x.validFrom))[0];
        return (
          <section key={farm.id} aria-label={farm.name} className="flex flex-col gap-3">
            {farms.length > 1 && <h2 className="text-[17px] font-semibold text-ink-2">{farm.name}</h2>}
            <p className="text-[13px] text-ink-2">{rule ? t("Planning.downtime", { days: String(rule.minDays), source: rule.source }) : t("Planning.noDowntime")}</p>
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
                      {houseTimeline(slots, min).map((line) => {
                        const plan = plans.find((p) => p.id === line.id);
                        return (
                          <li key={line.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                            {line.gapDays !== null && line.gapDays >= 0 && <span className="block text-[13px] text-ink-2">{t("Planning.gap", { days: String(line.gapDays) })}</span>}
                            <span className="block">
                              {line.kind === "batch" ? t("Planning.batch", { date: day(line.placeOn) }) : t("Planning.plan", { date: day(line.placeOn), chicks: String(plan?.chicks ?? 0), hatchery: plan?.hatchery ?? "" })}
                            </span>
                            <span className="block text-sm text-ink-2">{line.saleDay ? t("Planning.sale", { date: day(line.saleDay) }) : t("Planning.saleUnknown")}</span>
                            {line.overlaps && <span role="note" className="block text-sm font-medium text-brick-fg">{t("Planning.overlaps")}</span>}
                            {line.shortDowntime && <span role="note" className="block text-sm font-medium text-brick-fg">{t("Planning.short", { days: String(min) })}</span>}
                            {plan && manage && (
                              <button type="button" onClick={() => write(P.cancelPlan, "plannedBatch", { ...plan, status: "cancelled" }, { id: plan.id })} className={`${secondary} mt-2`}>
                                {t("Planning.cancel", { date: day(plan.placeOn) })}
                              </button>
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
      {manage && <PlanForm houses={houses} strains={strains} today={today} onSave={(p) => write(P.savePlan, "plannedBatch", p, { id: p.id, houseId: p.houseId, placeOn: p.placeOn, chicks: p.chicks, strainId: p.strainId, hatchery: p.hatchery, chickPriceCentimes: p.chickPriceCentimes ?? null, saleAge: p.saleAge })} />}
      {can(scope, "organization.manage") && <DowntimeForm farms={farms} today={today} onSave={(r) => write(P.saveDowntime, "downtimeRule", r)} />}
    </>
  );
}

type Strain = { id: string; name: string };

function PlanForm({ houses, strains, today, onSave }: { houses: HouseDto[]; strains: readonly Strain[]; today: string; onSave: (p: PlanDto) => Promise<void> }) {
  const t = useTranslations();
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
    await onSave({ id: uuidv7(), farmId: house.farmId, houseId: house.id, placeOn: get("day"), chicks, strainId: get("strain"), hatchery: get("hatchery"), chickPriceCentimes: price === null ? null : String(price), saleAge: age, status: "planned", batchId: null });
    setKey((k) => k + 1);
  };
  return (
    <form key={key} onSubmit={submit} className={card} aria-label={t("Planning.add")}>
      <label htmlFor={id.house}>{t("Planning.house")}</label>
      <select id={id.house} name="house" className={field}>
        {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      <label htmlFor={id.day}>{t("Planning.placeOn")}</label>
      <input id={id.day} name="day" type="date" required min={today} className={field} />
      <label htmlFor={id.chicks}>{t("Planning.chicks")}</label>
      <input id={id.chicks} name="chicks" inputMode="numeric" dir="ltr" required className={field} />
      <label htmlFor={id.strain}>{t("Planning.strain")}</label>
      <select id={id.strain} name="strain" required className={field}>
        {strains.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <label htmlFor={id.hatchery}>{t("Planning.hatchery")}</label>
      <input id={id.hatchery} name="hatchery" required maxLength={120} className={field} />
      <label htmlFor={id.price}>{t("Planning.price")}</label>
      <input id={id.price} name="price" inputMode="decimal" dir="ltr" className={field} />
      <label htmlFor={id.age}>{t("Planning.saleAge")}</label>
      <input id={id.age} name="age" inputMode="numeric" dir="ltr" className={field} />
      {error && <p role="alert">{t(error)}</p>}
      <button type="submit" className={primary}>{t("Planning.save")}</button>
    </form>
  );
}

function DowntimeForm({ farms, today, onSave }: { farms: FarmDto[]; today: string; onSave: (r: DowntimeRule) => Promise<void> }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const id = { farm: useId(), days: useId(), source: useId(), from: useId() };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={secondary}>{t("Planning.enterDowntime")}</button>;
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    await onSave({ id: uuidv7(), farmId: String(data.get("farm")), validFrom: String(data.get("from")), minDays: Number(data.get("days")), source: String(data.get("source")).trim() });
    setOpen(false);
  };
  return (
    <form onSubmit={submit} className={card} aria-label={t("Planning.enterDowntime")}>
      <p className="text-sm text-ink-2">{t("Planning.downtimeHint")}</p>
      {farms.length > 1 && (
        <>
          <label htmlFor={id.farm}>{t("Staff.farm")}</label>
          <select id={id.farm} name="farm" className={field}>
            {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </>
      )}
      {farms.length === 1 && <input type="hidden" name="farm" value={farms[0].id} />}
      <label htmlFor={id.days}>{t("Planning.minDays")}</label>
      <input id={id.days} name="days" type="number" min={0} max={365} required className={field} />
      <label htmlFor={id.source}>{t("Pay.source")}</label>
      <input id={id.source} name="source" required minLength={3} maxLength={300} className={field} />
      <label htmlFor={id.from}>{t("Pay.validFrom")}</label>
      <input id={id.from} name="from" type="date" required defaultValue={today} className={field} />
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Planning.saveDowntime")}</button>
        <button type="button" onClick={() => setOpen(false)} className={secondary}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
