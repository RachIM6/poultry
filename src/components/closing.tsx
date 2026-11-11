"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import type { Write } from "@/components/daily-entry";
import { formatDay, formatKg, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { Batch, FLOCK_MUTATIONS as M, type BatchCostDto, type BatchDto } from "@/modules/flock/schema";

// SPEC B6 on the batch screen: other costs while it runs, closing by hand with a reason, and the locked figures once
// closed. The last sale closes the batch by itself (sales). The cost per kg comes from the server, which values the
// consumptions; until the next sync after closing, the phone shows the batch closed without it.

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white";
const secondary = "rounded-lg border border-current/30 px-4 py-3";
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
    <section className="flex flex-col gap-1 rounded-lg border border-current/30 p-3" aria-label={t("summary")}>
      <span className="font-semibold">{t("closedOn", { date: formatDay((batch.closedOn ?? batch.placedOn) as FarmDay, locale) })}</span>
      <span>{batch.closeReason ? t("reasonLine", { reason: batch.closeReason }) : t("soldOut")}</span>
      {batch.soldGrams === undefined ? (
        <span className="opacity-75">{t("pending")}</span>
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

export function BatchCosts({ batch, costs, manage, write }: { batch: BatchDto; costs: BatchCostDto[]; manage: boolean; write: Write }) {
  const t = useTranslations();
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  if (!manage) return null; // amounts are money (I5)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const amount = parseCentimes(get("amount"));
    if (amount === null || !get("label")) return setError("errors.INVALID_INPUT");
    const cost = { id: uuidv7(), batchId: batch.id, day: get("day") || today(), label: get("label"), amountCentimes: String(amount) };
    const checked = aggregate(batch).checkCost(cost.day as FarmDay, amount, today()); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    setError(undefined);
    if (await write({ type: M.recordBatchCost, payload: cost }, [{ entity: "batchCost", id: cost.id, data: cost }])) setAdding(false);
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="cost-title">
      <h3 id="cost-title" className="text-lg font-semibold">{t("Closing.costs")}</h3>
      {costs.length === 0 ? (
        <p>{t("Closing.noCost")}</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-labelledby="cost-title">
          {[...costs].sort((a, b) => a.day.localeCompare(b.day)).map((c) => (
            <li key={c.id}>{t("Closing.costLine", { date: formatDay(c.day as FarmDay, locale), label: c.label, amount: formatMoney(BigInt(c.amountCentimes ?? 0)) })}</li>
          ))}
        </ul>
      )}
      {batch.status === "open" &&
        (adding ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label={t("Closing.label")}>{(id) => <input id={id} name="label" required maxLength={120} className={field} />}</Field>
            <Field label={t("Closing.amount")}>{(id) => <input id={id} name="amount" inputMode="decimal" required dir="ltr" className={field} />}</Field>
            <Field label={t("Closing.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today()} required className={field} />}</Field>
            {error && <p role="alert">{t(error)}</p>}
            <div className="flex gap-3">
              <button type="submit" className={primary}>{t("Closing.saveCost")}</button>
              <button type="button" onClick={() => setAdding(false)} className={secondary}>{t("Closing.cancel")}</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={secondary}>{t("Closing.addCost")}</button>
        ))}
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
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-current/30 p-3">
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
