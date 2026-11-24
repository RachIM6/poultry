"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { danger, field, primary, secondary, warn } from "@/components/ui";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes, typedCentimes } from "@/lib/kernel/money";
import type { CleanoutDto } from "@/modules/biosecurity/shared";
import type { HouseDto } from "@/modules/farm-registry/schema";
import type { TreasuryAccountDto } from "@/modules/finance/shared";
import { Batch, FLOCK_MUTATIONS as M, canJoinHouse, checkPaidOnDelivery, chicksCost, type BatchDto } from "@/modules/flock/shared";
import { HEALTH_MUTATIONS as H, planFor } from "@/modules/health/shared";
import type { LocalDb } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { downtimeByHouse, downtimeOn, houseCycles, placementDowntime, type DowntimeRule } from "@/modules/planning/shared";
import type { ProtocolDto } from "@/modules/reference-data/schema";
import { PRODUCTION_TYPES, type BirdSex, type ProductionType } from "@/modules/reference-data/shared";

// SPEC B1 and SPEC-m3 B7–B10: the placement form, in its own chunk: it only opens when a batch is placed, and the
// batches page has to stay within the 200 KB budget (SPEC §9.3, e2e/budget.spec.ts).

const today = () => farmDayOf(new Date());

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

export function PlacementForm({
  houses,
  strains,
  protocols,
  downtime,
  db,
  cashBoxes,
  onPlaced,
  onCancel,
}: {
  houses: (HouseDto & { label: string; busy: boolean; open: { species: ProductionType; sex?: BirdSex }[] })[];
  downtime: { batches: readonly BatchDto[]; cleanouts: readonly CleanoutDto[]; rules: readonly DowntimeRule[] };
  strains: { id: string; name: string; productionTypes: readonly ProductionType[] }[];
  protocols: ProtocolDto[];
  db: LocalDb;
  cashBoxes?: TreasuryAccountDto[]; // SPEC-finance §9 "Chicks paid on delivery": finance.record's roles only, as on the phone
  onPlaced: (ok: boolean) => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const [error, setError] = useState<string>();
  const [type, setType] = useState<ProductionType>("broiler"); // R5: the type first, then only its strains
  const typeStrains = strains.filter((s) => s.productionTypes.includes(type));
  const [bySex, setBySex] = useState(false); // SPEC-m3 B9: turkeys only
  const sexed = type === "turkey" && bySex;
  const [draft, setDraft] = useState<{ houseId?: string; placedOn: string; total: bigint }>({ houseId: houses[0]?.id, placedOn: today(), total: 0n });
  const [paidOn, setPaidOn] = useState(false); // §9: paid in cash at delivery
  const chosen = houses.find((h) => h.id === draft.houseId);
  // SPEC-m2-compliance BS5, CQ3: planning's one figure, from the disinfection day else the removal; a warning, never a block.
  const min = chosen && downtimeOn(downtime.rules, chosen.farmId, draft.placedOn);
  const disinfected = new Map(downtime.cleanouts.flatMap((c) => c.steps.filter((s) => s.step === "disinfection").map((s) => [c.afterBatchId, s.day] as const)));
  const farmHouses = houses.filter((h) => h.farmId === chosen?.farmId);
  const warning = chosen && min && placementDowntime(min.minDays, downtimeByHouse(type), houseCycles(farmHouses.map((h) => h.id), downtime.batches, disinfected), chosen.id, draft.placedOn);

  const groups: { sex: BirdSex; birds: string; doa: string }[] = sexed
    ? [{ sex: "female", birds: "females", doa: "femaleDoa" }, { sex: "male", birds: "males", doa: "maleDoa" }]
    : [{ sex: "mixed", birds: "chicksPlaced", doa: "deadOnArrival" }];
  const read = (data: FormData) => {
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const int = (k: string) => (/^\d+$/.test(get(k)) ? Number(get(k)) : NaN);
    const price = parseCentimes(get("price") || "0");
    const vat = get("vat") ? parseCentimes(get("vat")) : 0n; // SPEC-finance FN9: on top of the price, for the delivery
    const birds = groups.reduce((n, g) => n + int(g.birds), 0);
    // §9: the delivery's total, what "paid on delivery" is prefilled with
    const total = price !== null && vat !== null && Number.isSafeInteger(birds) ? chicksCost(birds, price) + vat : 0n;
    return { get, int, price, vat, birds, total };
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const { get, int, price, vat, birds } = read(data);
    const house = houses.find((h) => h.id === get("houseId"));
    const tenths = (v: string) => (/^\d+([.,]\d)?$/.test(v) ? Math.round(Number(v.replace(",", ".")) * 10) : NaN);
    if (!house || price === null || vat === null || !get("hatchery") || !get("deliveryNote")) return setError("Batches.invalid");
    const open = [...house.open];
    for (const g of groups) {
      if (!canJoinHouse(type, open, g.sex).ok) return setError("errors.HOUSE_HAS_OPEN_BATCH"); // the server enforces it too (B8)
      open.push({ species: type, sex: g.sex });
    }

    const placements = groups.map((g) => ({
      id: uuidv7(),
      farmId: house.farmId,
      houseId: house.id,
      species: type,
      sex: g.sex,
      strainId: get("strainId"),
      placedOn: (get("placedOn") || today()) as FarmDay,
      chicksPlaced: int(g.birds),
      deadOnArrival: get(g.doa) ? int(g.doa) : 0,
      hatchery: get("hatchery"),
      deliveryNote: get("deliveryNote"),
      chickUnitPriceCentimes: price,
      dayOldWeightGrams: get("dayOldWeight") ? int("dayOldWeight") : null,
      ageAtPlacementDays: get("ageWeeks") ? int("ageWeeks") * 7 : 0, // SPEC-m3 B7: asked in weeks
      // SPEC-m3 B10, optional; a sexed placement takes no supplement (it is per delivery, not per sex)
      freeChicks: !sexed && get("freeChicks") ? int("freeChicks") : 0,
      parentFlock: get("parentFlock") || null,
      weakChicks: !sexed && get("weakChicks") ? int("weakChicks") : null,
      litterTempTenths: get("litterTemp") ? tenths(get("litterTemp")) : null,
    }));
    for (const placement of placements) {
      const batch = Batch.place(placement, today()); // the same rules as the server
      if (!batch.ok) return setError(batch.error === "INVALID_QUANTITY" ? "Batches.invalid" : `errors.${batch.error}`);
    }
    const paid = paidOn && cashBoxes?.length ? { cashAccountId: get("paidCashBox"), amount: parseCentimes(get("paidAmount")) ?? 0n } : null;
    const fits = paid && checkPaidOnDelivery(paid.amount, birds, price, vat); // §9, as the server
    if (fits && !fits.ok) return setError(fits.error === "INVALID_INPUT" ? "Batches.invalid" : `errors.${fits.error}`);
    setError(undefined);

    // farmId is dropped by the schema: the server derives it. One delivery's VAT goes on its first batch (a sexed placement),
    // and what was paid at delivery on the batches in turn, each up to its own total (§9).
    let left = paid?.amount ?? 0n;
    const sent = placements.map((p, i) => {
      const its = i === 0 ? vat : 0n;
      const own = chicksCost(p.chicksPlaced, price) + its;
      const pay = left < own ? left : own;
      left -= pay;
      const paidOnDelivery = paid && pay > 0n ? { cashAccountId: paid.cashAccountId, amountCentimes: String(pay) } : null;
      return { ...p, chickUnitPriceCentimes: String(price), chickVatCentimes: its > 0n ? String(its) : null, paidOnDelivery };
    });
    const protocol = protocols.find((p) => p.id === get("protocolId"));
    try {
      for (const p of sent) {
        const batch: BatchDto = { ...p, status: "open" };
        await writeLocal(db, { type: M.placeBatch, payload: p }, [{ entity: "batch", id: batch.id, data: batch }]);
        if (protocol && protocol.items.length > 0) {
          // H1: the plan from the farm's protocol, queued right after the placement it belongs to
          const plan = planFor(batch.id, batch.placedOn as FarmDay, protocol.items, batch.ageAtPlacementDays);
          const items = protocol.items;
          await writeLocal(db, { type: H.planVaccinations, payload: { batchId: batch.id, protocolId: protocol.id, items } }, plan.map((v) => ({ entity: "vaccination", id: v.id, data: v })));
        }
      }
      onPlaced(true);
    } catch {
      onPlaced(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      onChange={(e) => {
        const data = new FormData(e.currentTarget);
        setDraft({ houseId: String(data.get("houseId")), placedOn: String(data.get("placedOn") || today()), total: read(data).total });
      }}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-3"
    >
      <Select label={t("Batches.house")} name="houseId">
        {houses.map((h) => (
          <option key={h.id} value={h.id}>{h.busy ? t("Batches.houseBusy", { house: h.label }) : h.label}</option>
        ))}
      </Select>
      <div className="flex flex-col gap-1">
        <label htmlFor="placement-type">{t("Batches.type")}</label>
        <select id="placement-type" value={type} onChange={(e) => setType(e.target.value as ProductionType)} className={field}>
          {PRODUCTION_TYPES.map((p) => <option key={p} value={p}>{t(`Types.${p}`)}</option>)}
        </select>
      </div>
      <Select key={type} label={t("Batches.strain")} name="strainId">
        {typeStrains.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      {protocols.length > 0 && (
        <Select label={t("Batches.protocol")} name="protocolId">
          {protocols.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="">{t("Batches.noProtocol")}</option>
        </Select>
      )}
      <Field name="placedOn" label={t("Batches.placedOn")} type="date" defaultValue={today()} required />
      {type !== "broiler" && <Field name="ageWeeks" label={t("Batches.ageAtPlacement")} inputMode="numeric" pattern="\d+" defaultValue="0" dir="ltr" />}
      {type === "turkey" && (
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={bySex} onChange={(e) => setBySex(e.target.checked)} className="size-5" />
          {t("Batches.bySex")}
        </label>
      )}
      {sexed ? (
        <>
          <Field name="females" label={t("Batches.females")} inputMode="numeric" pattern="\d+" required dir="ltr" />
          <Field name="femaleDoa" label={t("Batches.femaleDoa")} inputMode="numeric" pattern="\d+" defaultValue="0" dir="ltr" />
          <Field name="males" label={t("Batches.males")} inputMode="numeric" pattern="\d+" required dir="ltr" />
          <Field name="maleDoa" label={t("Batches.maleDoa")} inputMode="numeric" pattern="\d+" defaultValue="0" dir="ltr" />
        </>
      ) : (
        <>
          <Field name="chicksPlaced" label={t("Batches.chicksPlaced")} inputMode="numeric" pattern="\d+" required dir="ltr" />
          <Field name="deadOnArrival" label={t("Batches.deadOnArrival")} inputMode="numeric" pattern="\d+" defaultValue="0" dir="ltr" />
        </>
      )}
      {!sexed && <Field name="freeChicks" label={t("Batches.freeChicks")} inputMode="numeric" pattern="\d+" dir="ltr" />}
      <Field name="hatchery" label={t("Batches.hatchery")} required maxLength={120} />
      <Field name="deliveryNote" label={t("Batches.deliveryNote")} required maxLength={60} dir="ltr" />
      <Field name="price" label={t("Batches.chickPrice")} inputMode="decimal" required dir="ltr" />
      <Field name="vat" label={t("Batches.chickVat")} inputMode="decimal" dir="ltr" />
      {cashBoxes && cashBoxes.length === 0 && <p className="text-sm text-ink-2">{t("Batches.paidNoCashBox")}</p>}
      {cashBoxes && cashBoxes.length > 0 && (
        <div className="flex flex-col gap-3">
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={paidOn} onChange={(e) => setPaidOn(e.target.checked)} className="size-5" />
            {t("Batches.paidOnDelivery")}
          </label>
          {paidOn && (
            <>
              <Select label={t("Batches.paidCashBox")} name="paidCashBox">
                {cashBoxes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
              <Field key={String(draft.total)} name="paidAmount" label={t("Batches.paidAmount")} inputMode="decimal" required defaultValue={typedCentimes(draft.total)} dir="ltr" />
              <p className="text-sm text-ink-2">{t("Batches.paidHint")}</p>
            </>
          )}
        </div>
      )}
      <Field name="dayOldWeight" label={t("Batches.dayOldWeight")} inputMode="numeric" pattern="\d+" dir="ltr" />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">{t("Batches.arrival")}</legend>
        <Field name="parentFlock" label={t("Batches.parentFlock")} maxLength={60} dir="ltr" />
        {!sexed && <Field name="weakChicks" label={t("Batches.weakChicks")} inputMode="numeric" pattern="\d+" dir="ltr" />}
        <Field name="litterTemp" label={t("Batches.litterTemp")} inputMode="decimal" dir="ltr" />
      </fieldset>
      {warning && min && (
        <p role="status" className={warn}>
          {warning.kind === "short"
            ? t("Batches.downtimeWarning", { elapsed: warning.elapsedDays, min: warning.minDays, source: min.source })
            : t("Batches.downtimeOccupied", { house: farmHouses.find((h) => h.id === warning.houseId)?.name ?? "" })}
        </p>
      )}
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Batches.save")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Batches.cancel")}</button>
      </div>
    </form>
  );
}

