"use client";

import { useTranslations } from "next-intl";
import { useId, type FormEvent, type InputHTMLAttributes } from "react";
import type { Write } from "@/components/daily-entry";
import { useFieldError, useInline } from "@/components/focus";
import { formActions } from "@/components/layout";
import { Sheet } from "@/components/sheet";
import { danger, field, ghost, primary, secondarySm } from "@/components/ui";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes, typedCentimes } from "@/lib/kernel/money";
import type { HouseDto } from "@/modules/farm-registry/schema";
import {
  Batch,
  FLOCK_MUTATIONS as M,
  canJoinHouse,
  correctPlacement,
  houseFreeFrom,
  recordedOf,
  type BatchDto,
  type CorrectionError,
  type DailyEntryDto,
  type PlacementCorrection,
  type SoldBirdsDto,
  type WeighingDto,
} from "@/modules/flock/shared";
import { checkPlacementBeforeRecords, movedWithPlacement, type TreatmentDto, type VaccinationDto, type VetVisitDto } from "@/modules/health/shared";
import type { ProductionType } from "@/modules/reference-data/shared";

// SPEC B1 "Correcting a placement" on an open batch, in its own chunk: /batches has no room to grow (SPEC §9.3). The
// phone runs the server's rule (correctPlacement) on its own records; the server checks again when it syncs.

const today = () => farmDayOf(new Date());

function Field({ label, name, ...input }: { label: string; name: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} className={field} {...input} />
    </div>
  );
}

// The field each refusal points at (WCAG 3.3.1).
const FIELD_OF: Partial<Record<CorrectionError | "HOUSE_HAS_OPEN_BATCH", string>> = {
  BATCH_HAS_DATA: "houseId",
  HOUSE_HAS_OPEN_BATCH: "houseId",
  PLACEMENT_IN_FUTURE: "placedOn",
  PLACEMENT_AFTER_DATA: "placedOn",
  PLACEMENT_OVERLAPS_PREVIOUS: "placedOn",
  DEAD_ON_ARRIVAL_TOO_HIGH: "deadOnArrival",
  FEWER_BIRDS_THAN_RECORDED: "chicksPlaced",
};

export function CorrectPlacement({
  batch,
  title,
  houses,
  batches,
  entries,
  weighings,
  sold,
  strains,
  vaccinations,
  treatments,
  visits,
  write,
}: {
  batch: BatchDto;
  title: string;
  houses: HouseDto[];
  batches: BatchDto[];
  entries: DailyEntryDto[];
  weighings: WeighingDto[];
  sold: SoldBirdsDto[];
  strains: { id: string; name: string; productionTypes?: readonly ProductionType[] }[];
  vaccinations: VaccinationDto[];
  treatments: TreatmentDto[];
  visits: VetVisitDto[];
  write: Write;
}) {
  const t = useTranslations();
  const { open, opener, close } = useInline<"correct">();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();

  const { firstDay, birdsOut } = recordedOf(entries, weighings, sold);
  const openIn = (houseId: string) => batches.filter((b) => b.status === "open" && b.houseId === houseId && b.id !== batch.id);
  // The batch's farm only; another house only before any data, and only one that would take it (SPEC-m3 B8, B9).
  const choices = houses.filter((h) => h.id === batch.houseId || (!firstDay && h.farmId === batch.farmId && canJoinHouse(batch.species, openIn(h.id), batch.sex).ok));
  const typeStrains = strains.filter((s) => s.id === batch.strainId || (s.productionTypes ?? ["broiler"]).includes(batch.species));
  const money = batch.chickUnitPriceCentimes !== undefined; // absent for a role without money (SPEC I5)
  const sexed = (batch.sex ?? "mixed") !== "mixed"; // SPEC-m3 B10: no free supplement on a batch of one sex

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const int = (k: string) => (/^\d+$/.test(get(k)) ? Number(get(k)) : NaN);
    const price = money ? parseCentimes(get("price")) : 0n;
    const vat = get("vat") ? parseCentimes(get("vat")) : null;
    if (price === null) return setError("Batches.invalid", form, "price");
    if (get("vat") && vat === null) return setError("Batches.invalid", form, "vat");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(get("placedOn"))) return setError("Batches.invalid", form, "placedOn");
    if (!get("hatchery") || !get("deliveryNote")) return setError("Batches.invalid", form, get("hatchery") ? "deliveryNote" : "hatchery");

    const typed: Record<string, string | number | null> = {
      ...(data.has("houseId") && { houseId: get("houseId") }),
      strainId: get("strainId"),
      placedOn: get("placedOn"),
      chicksPlaced: int("chicksPlaced"),
      ...(data.has("freeChicks") && { freeChicks: get("freeChicks") ? int("freeChicks") : 0 }),
      deadOnArrival: get("deadOnArrival") ? int("deadOnArrival") : 0,
      hatchery: get("hatchery"),
      deliveryNote: get("deliveryNote"),
      ...(money && { chickUnitPriceCentimes: String(price), chickVatCentimes: vat === null ? null : String(vat) }),
    };
    const was: Record<string, unknown> = { ...batch, freeChicks: batch.freeChicks ?? 0, chickVatCentimes: batch.chickVatCentimes ?? null };
    const changes = Object.fromEntries(Object.entries(typed).filter(([k, v]) => v !== was[k]));
    if (Object.keys(changes).length === 0) return setError("Correct.noChange");

    // The VAT is finance's (FN9): no flock rule reads it. The price is centimes in the aggregate.
    const placement = Object.fromEntries(
      Object.entries(changes).flatMap(([k, v]) => (k === "chickVatCentimes" ? [] : [[k, k === "chickUnitPriceCentimes" ? BigInt(v as string) : v]])),
    ) as PlacementCorrection;
    const aggregate = Batch.rehydrate({ ...batch, placedOn: batch.placedOn as FarmDay, chickUnitPriceCentimes: BigInt(batch.chickUnitPriceCentimes ?? 0) }, batch.status);
    const freeFrom = houseFreeFrom(batch, placement.houseId ?? batch.houseId, batches);
    const checked = correctPlacement(aggregate, placement, { firstDay, birdsOut, houseFreeFrom: freeFrom }, today()); // as the server
    if (!checked.ok) return setError(checked.error === "INVALID_QUANTITY" ? "Batches.invalid" : `errors.${checked.error}`, form, FIELD_OF[checked.error]);
    // Then health's rule, as the server chains it: not after a vaccine given, a treatment started or a vet visit (B1).
    const recorded = [...vaccinations.flatMap((v) => (v.done ? [v.done.on] : [])), ...treatments.map((x) => x.startOn), ...visits.map((v) => v.on)];
    const health = placement.placedOn && checkPlacementBeforeRecords(placement.placedOn, recorded);
    if (health && !health.ok) return setError(`errors.${health.error}`, form, "placedOn");
    setError(undefined);
    // The plan's lines not yet done move with the placement day, as the server moves them (B1).
    const moved = placement.placedOn ? movedWithPlacement(vaccinations, { ...batch, placedOn: placement.placedOn }) : [];
    const records = [{ entity: "batch", id: batch.id, data: { ...batch, ...changes } }, ...moved.map((v) => ({ entity: "vaccination", id: v.id, data: v }))];
    const saved = await write({ type: M.correctPlacement, payload: { batchId: batch.id, changes } }, records);
    if (saved) close();
  };

  const number = { inputMode: "numeric", pattern: "\\d+", dir: "ltr" } as const;
  // tasks/plan-ui-cleanup.md §2.7: an occasional form, in a sheet.
  return (
    <>
      <button type="button" aria-haspopup="dialog" {...opener("correct")} aria-label={t("Correct.openLabel", { batch: title })} className={secondarySm}>
        {t("Correct.open")}
      </button>
      <Sheet open={open === "correct"} onClose={close} title={t("Correct.open")}>
        <form onSubmit={submit} className="flex flex-col gap-3" aria-label={t("Correct.open")}>
          <p className="text-muted">{t("Correct.hint")}</p>
          {firstDay ? (
            <p>{t("Correct.houseLocked")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="correct-house">{t("Batches.house")}</label>
              <select id="correct-house" name="houseId" defaultValue={batch.houseId} autoFocus {...bad("houseId")} className={field}>
                {choices.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="correct-strain">{t("Batches.strain")}</label>
            <select id="correct-strain" name="strainId" defaultValue={batch.strainId} autoFocus={!!firstDay} className={field}>
              {typeStrains.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Field name="placedOn" label={t("Batches.placedOn")} type="date" defaultValue={batch.placedOn} required {...bad("placedOn")} />
          <Field name="chicksPlaced" label={t("Batches.chicksPlaced")} defaultValue={batch.chicksPlaced} required {...number} {...bad("chicksPlaced")} />
          {!sexed && <Field name="freeChicks" label={t("Batches.freeChicks")} defaultValue={batch.freeChicks ?? 0} {...number} />}
          <Field name="deadOnArrival" label={t("Batches.deadOnArrival")} defaultValue={batch.deadOnArrival} {...number} {...bad("deadOnArrival")} />
          <Field name="hatchery" label={t("Batches.hatchery")} defaultValue={batch.hatchery} required maxLength={120} {...bad("hatchery")} />
          <Field name="deliveryNote" label={t("Batches.deliveryNote")} defaultValue={batch.deliveryNote} required maxLength={60} dir="ltr" {...bad("deliveryNote")} />
          {money && (
            <>
              <Field name="price" label={t("Batches.chickPrice")} defaultValue={typedCentimes(BigInt(batch.chickUnitPriceCentimes ?? 0))} inputMode="decimal" required dir="ltr" {...bad("price")} />
              <Field name="vat" label={t("Batches.chickVat")} defaultValue={batch.chickVatCentimes ? typedCentimes(BigInt(batch.chickVatCentimes)) : ""} inputMode="decimal" dir="ltr" {...bad("vat")} />
            </>
          )}
          {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
          <div className={formActions}>
            <button type="submit" className={primary}>{t("Correct.save")}</button>
            <button type="button" onClick={close} className={ghost}>{t("Batches.cancel")}</button>
          </div>
        </form>
      </Sheet>
    </>
  );
}
