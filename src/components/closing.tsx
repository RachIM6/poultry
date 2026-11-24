"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import type { Write } from "@/components/daily-entry";
import { formatDay, formatKg, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { Batch, FLOCK_MUTATIONS as M, TRANSFER_REASON, ageOfBatch, type BatchCostDto, type BatchDto } from "@/modules/flock/shared";
import { field, primary, secondary } from "@/components/ui";

// SPEC B6 on the batch screen: its other costs (read-only, FN13), closing by hand with a reason, and the locked figures once
// closed. The last sale closes the batch by itself (sales). The cost per kg comes from the server, which values the
// consumptions; until the next sync after closing, the phone shows the batch closed without it.

const today = () => farmDayOf(new Date());
const aggregate = (b: BatchDto) => Batch.rehydrate({ ...b, placedOn: b.placedOn as FarmDay, chickUnitPriceCentimes: 0n }, b.status);

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

/** The batch closed locally, as the server will close it (its figures arrive with the next sync). */
export const closedLocally = (batch: BatchDto, day: string, reason: string | null): BatchDto => ({ ...batch, status: "closed", closedOn: day, closeReason: reason });

export function ClosedSummary({ batch }: { batch: BatchDto }) {
  const t = useTranslations("Closing");
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-1 rounded-2xl border border-line bg-card p-3" aria-label={t("summary")}>
      <span className="font-semibold">{t("closedOn", { date: formatDay((batch.closedOn ?? batch.placedOn) as FarmDay, locale) })}</span>
      <span>{batch.closeReason === TRANSFER_REASON ? t("transferred") : batch.closeReason ? t("reasonLine", { reason: batch.closeReason }) : t("soldOut")}</span>
      {batch.soldGrams === undefined ? (
        <span className="text-muted">{t("pending")}</span>
      ) : (
        <>
          <span>{t("sold", { kg: formatKg(batch.soldGrams) })}</span>
          {batch.costCentimes && <span>{t("cost", { amount: formatMoney(BigInt(batch.costCentimes)) })}</span>}
          {batch.costPerKgCentimes !== undefined && (
            <span className="font-semibold">{batch.costPerKgCentimes === null ? t("noCostPerKg") : t("costPerKg", { amount: formatMoney(BigInt(batch.costPerKgCentimes)) })}</span>
          )}
        </>
      )}
    </section>
  );
}

/**
 * B6's other costs, read-only since SPEC-finance FN13: a cost of the batch is now a quick expense charged to it, which
 * posts (§9 "M1 other costs"). The ones recorded before still count in the batch's cost.
 */
export function BatchCosts({ batch, costs, manage }: { batch: BatchDto; costs: BatchCostDto[]; manage: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  if (!manage || (costs.length === 0 && batch.status !== "open")) return null; // amounts are money (I5)
  return (
    <section className="flex flex-col gap-3" aria-labelledby={costs.length > 0 ? "cost-title" : undefined}>
      {costs.length > 0 && (
        <>
          <h3 id="cost-title" className="text-[17px] font-semibold text-ink-2">{t("Closing.costs")}</h3>
          <ul className="flex flex-col gap-1" aria-labelledby="cost-title">
            {[...costs].sort((a, b) => a.day.localeCompare(b.day)).map((c) => (
              <li key={c.id}>{t("Closing.costLine", { date: formatDay(c.day as FarmDay, locale), label: c.label, amount: formatMoney(BigInt(c.amountCentimes ?? 0)) })}</li>
            ))}
          </ul>
        </>
      )}
      {batch.status === "open" && <Link href="/expenses" className="underline underline-offset-4">{t("Closing.addCost")}</Link>}
    </section>
  );
}

export function CloseBatchForm({ batch, write }: { batch: BatchDto; write: Write }) {
  const t = useTranslations();
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string>();
  if (!closing) return <button type="button" onClick={() => setClosing(true)} className={secondary}>{t("Closing.close")}</button>;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const day = get("day") || today();
    if (!get("reason")) return setError("errors.INVALID_INPUT");
    const checked = aggregate(batch).close(day as FarmDay, today()); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    setError(undefined);
    const payload = { batchId: batch.id, day, reason: get("reason") };
    await write({ type: M.closeBatch, payload }, [{ entity: "batch", id: batch.id, data: closedLocally(batch, day, payload.reason) }]);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-3">
      <p>{t("Closing.warning")}</p>
      <Field label={t("Closing.reason")}>{(id) => <input id={id} name="reason" required maxLength={200} className={field} />}</Field>
      <Field label={t("Closing.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today()} required className={field} />}</Field>
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Closing.confirm")}</button>
        <button type="button" onClick={() => setClosing(false)} className={secondary}>{t("Closing.cancel")}</button>
      </div>
    </form>
  );
}

/** SPEC-m3 B13: a pullet batch moves to a laying house. The server culls the birds left behind and closes it. */
export function TransferForm({ batch, onHand, houses, write }: { batch: BatchDto; onHand: number; houses: { id: string; label: string; free: boolean }[]; write: Write }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [hens, setHens] = useState(String(onHand));
  const [error, setError] = useState<string>();
  const free = houses.filter((h) => h.free);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={secondary}>{t("Transfer.title")}</button>;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const day = (get("day") || today()) as FarmDay;
    const count = /^\d+$/.test(hens) ? Number(hens) : NaN;
    const checked = aggregate(batch).checkTransfer(day, count, onHand, today()); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    const house = free.find((h) => h.id === get("houseId"));
    if (!house) return setError("Transfer.noHouse");
    setError(undefined);
    const payload = { batchId: batch.id, day, newBatchId: uuidv7(), houseId: house.id, hens: count };
    const layers: BatchDto = {
      ...batch,
      id: payload.newBatchId,
      houseId: house.id,
      species: "layer",
      sex: "mixed",
      placedOn: day,
      chicksPlaced: count,
      deadOnArrival: 0,
      freeChicks: 0,
      dayOldWeightGrams: null,
      ageAtPlacementDays: ageOfBatch(batch, day),
      fromBatchId: batch.id,
      status: "open",
      chickUnitPriceCentimes: batch.chickUnitPriceCentimes === undefined ? undefined : "0",
      chickVatCentimes: null, // the pullets' VAT stays on their placement
    };
    await write({ type: M.transferToLaying, payload }, [
      { entity: "batch", id: batch.id, data: closedLocally(batch, day, TRANSFER_REASON) },
      { entity: "batch", id: layers.id, data: layers },
    ]);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-labelledby="transfer-title">
      <h3 id="transfer-title" className="text-lg font-semibold">{t("Transfer.title")}</h3>
      {free.length === 0 ? (
        <p>{t("Transfer.noHouse")}</p>
      ) : (
        <>
          <Field label={t("Transfer.house")}>
            {(id) => (
              <select id={id} name="houseId" className={field}>
                {free.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
              </select>
            )}
          </Field>
          <Field label={t("Transfer.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today()} required className={field} />}</Field>
          <Field label={t("Transfer.hens")}>
            {(id) => <input id={id} value={hens} onChange={(e) => setHens(e.target.value)} inputMode="numeric" pattern="\d+" required dir="ltr" className={field} />}
          </Field>
          {/^\d+$/.test(hens) && Number(hens) < onHand && <p>{t("Transfer.left", { birds: String(onHand - Number(hens)) })}</p>}
          {error && <p role="alert">{t(error)}</p>}
          <div className="flex gap-3">
            <button type="submit" className={primary}>{t("Transfer.save")}</button>
            <button type="button" onClick={() => setOpen(false)} className={secondary}>{t("Closing.cancel")}</button>
          </div>
        </>
      )}
    </form>
  );
}
