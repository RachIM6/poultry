"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { useBatchResults } from "@/components/batch-results";
import type { Write } from "@/components/daily-entry";
import { useFieldError, useInline } from "@/components/focus";
import { formActions, sectionTitle } from "@/components/layout";
import { Sheet } from "@/components/sheet";
import { formatDay, formatKg, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { Batch, FLOCK_MUTATIONS as M, TRANSFER_REASON, ageOfBatch, type BatchCostDto, type BatchDto } from "@/modules/flock/shared";
import { danger, field, ghost, link, primary, secondarySm } from "@/components/ui";

// SPEC B6 on the batch screen: its other costs (read-only, FN13), closing by hand with a reason, and the figures once
// closed. The last sale closes the batch by itself (sales); until the next sync after closing, the phone shows the batch
// closed without its kg sold. Its cost and cost per kg are FN13's, read from the server when online, the same as
// /results (SPEC-finance §9 "One cost per kg"), not B6's figure locked on the batch.

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

export function ClosedSummary({ batch, money }: { batch: BatchDto; money: boolean }) {
  const t = useTranslations("Closing");
  const locale = useLocale();
  const result = useBatchResults(money, `${batch.id}:${batch.soldGrams}`)?.find((r) => r.id === batch.id);
  return (
    <section className="flex flex-col gap-1 rounded-2xl border border-line bg-card p-3" aria-label={t("summary")}>
      <span className="font-semibold">{t("closedOn", { date: formatDay((batch.closedOn ?? batch.placedOn) as FarmDay, locale) })}</span>
      <span>{batch.closeReason === TRANSFER_REASON ? t("transferred") : batch.closeReason ? t("reasonLine", { reason: batch.closeReason }) : t("soldOut")}</span>
      {batch.soldGrams === undefined ? (
        <span className="text-muted">{t("pending")}</span>
      ) : (
        <>
          <span>{t("sold", { kg: formatKg(batch.soldGrams) })}</span>
          {result ? (
            <>
              <span>{t("cost", { amount: formatMoney(BigInt(result.costCentimes)) })}</span>
              {result.hens && <span className="text-muted">{t("hens", { amount: formatMoney(BigInt(result.hens.centimes)) })}</span>}
              {result.transferredCentimes && <span className="text-muted">{t("transferredCost", { amount: formatMoney(BigInt(result.transferredCentimes)) })}</span>}
              <span className="font-semibold">{result.costPerKgCentimes === null ? t("noCostPerKg") : t("costPerKg", { amount: formatMoney(BigInt(result.costPerKgCentimes)) })}</span>
            </>
          ) : (
            money && <span className="text-muted">{t("costOnline")}</span> // offline, or still loading: read from the server
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
          <h2 id="cost-title" className={sectionTitle}>{t("Closing.costs")}</h2>
          <ul className="flex flex-col gap-1" aria-labelledby="cost-title">
            {[...costs].sort((a, b) => a.day.localeCompare(b.day)).map((c) => (
              <li key={c.id}>{t("Closing.costLine", { date: formatDay(c.day as FarmDay, locale), label: c.label, amount: formatMoney(BigInt(c.amountCentimes ?? 0)) })}</li>
            ))}
          </ul>
        </>
      )}
      {batch.status === "open" && <Link href="/expenses" className={link}>{t("Closing.addCost")}</Link>}
    </section>
  );
}

export function CloseBatchForm({ batch, write }: { batch: BatchDto; write: Write }) {
  const t = useTranslations();
  const { open, opener, close } = useInline<"close">();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const day = get("day") || today();
    if (!get("reason")) return setError("errors.INVALID_INPUT", e.currentTarget, "reason");
    const checked = aggregate(batch).close(day as FarmDay, today()); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`, e.currentTarget, checked.error === "BATCH_CLOSED" ? undefined : "day");
    setError(undefined);
    const payload = { batchId: batch.id, day, reason: get("reason") };
    await write({ type: M.closeBatch, payload }, [{ entity: "batch", id: batch.id, data: closedLocally(batch, day, payload.reason) }]);
  };

  // tasks/plan-ui-cleanup.md §2.7: an occasional form, in a sheet.
  return (
    <>
      <button type="button" aria-haspopup="dialog" {...opener("close")} className={secondarySm}>{t("Closing.close")}</button>
      <Sheet open={open === "close"} onClose={close} title={t("Closing.close")}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p>{t("Closing.warning")}</p>
          <Field label={t("Closing.reason")}>{(id) => <input id={id} name="reason" required maxLength={200} autoFocus {...bad("reason")} className={field} />}</Field>
          <Field label={t("Closing.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today()} required {...bad("day")} className={field} />}</Field>
          {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
          <div className={formActions}>
            <button type="submit" className={primary}>{t("Closing.confirm")}</button>
            <button type="button" onClick={close} className={ghost}>{t("Closing.cancel")}</button>
          </div>
        </form>
      </Sheet>
    </>
  );
}

/** SPEC-m3 B13: a pullet batch moves to a laying house. The server culls the birds left behind and closes it. */
export function TransferForm({ batch, onHand, houses, write }: { batch: BatchDto; onHand: number; houses: { id: string; label: string; free: boolean }[]; write: Write }) {
  const t = useTranslations();
  const { open, opener, close } = useInline<"transfer">();
  const [hens, setHens] = useState(String(onHand));
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  const free = houses.filter((h) => h.free);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const day = (get("day") || today()) as FarmDay;
    const count = /^\d+$/.test(hens) ? Number(hens) : NaN;
    const checked = aggregate(batch).checkTransfer(day, count, onHand, today()); // as the server
    if (!checked.ok) {
      const name = checked.error.startsWith("DAY_") ? "day" : checked.error === "INVALID_QUANTITY" || checked.error === "MORE_BIRDS_THAN_ON_HAND" ? "hens" : undefined;
      return setError(`errors.${checked.error}`, e.currentTarget, name);
    }
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
    <>
      <button type="button" aria-haspopup="dialog" {...opener("transfer")} className={secondarySm}>{t("Transfer.title")}</button>
      <Sheet open={open === "transfer"} onClose={close} title={t("Transfer.title")}>
        <form onSubmit={submit} className="flex flex-col gap-3" aria-label={t("Transfer.title")}>
          {free.length === 0 ? (
            <>
              <p>{t("Transfer.noHouse")}</p>
              <button type="button" onClick={close} autoFocus className={ghost}>{t("Closing.cancel")}</button>
            </>
          ) : (
            <>
              <Field label={t("Transfer.house")}>
                {(id) => (
                  <select id={id} name="houseId" autoFocus className={field}>
                    {free.map((h) => <option key={h.id} value={h.id}>{h.id === batch.houseId ? t("Transfer.sameHouse", { house: h.label }) : h.label}</option>)}
                  </select>
                )}
              </Field>
              <Field label={t("Transfer.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today()} required {...bad("day")} className={field} />}</Field>
              <Field label={t("Transfer.hens")}>
                {(id) => <input id={id} name="hens" {...bad("hens")} value={hens} onChange={(e) => setHens(e.target.value)} inputMode="numeric" pattern="\d+" required dir="ltr" className={field} />}
              </Field>
              {/^\d+$/.test(hens) && Number(hens) < onHand && <p>{t("Transfer.left", { birds: String(onHand - Number(hens)) })}</p>}
              {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
              <div className={formActions}>
                <button type="submit" className={primary}>{t("Transfer.save")}</button>
                <button type="button" onClick={close} className={ghost}>{t("Closing.cancel")}</button>
              </div>
            </>
          )}
        </form>
      </Sheet>
    </>
  );
}
