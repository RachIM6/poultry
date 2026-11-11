"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import type { Write } from "@/components/daily-entry";
import { formatDay } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import type { BatchDto } from "@/modules/flock/schema";
import {
  HEALTH_MUTATIONS as H,
  checkBatchDay,
  checkTreatment,
  withdrawalEnd,
  withdrawalUntil,
  type TreatmentDto,
  type VetVisitDto,
} from "@/modules/health/schema";
import { parseQuantity, type MovementDto, type StockItemDto } from "@/modules/inventory/schema";

// SPEC H3–H5 on the batch screen, offline: the withdrawal banner, treatments with the lot they came from, vet visits.
// The phone runs the same checks and the same withdrawal rule as the server.

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white";
const secondary = "rounded-lg border border-current/30 px-4 py-3";
const today = () => farmDayOf(new Date());
const asDays = (t: TreatmentDto) => ({ endOn: t.endOn as FarmDay, withdrawalDays: t.withdrawalDays });

/** H4: shown while a withdrawal runs, gone the day after it ends. */
export function WithdrawalBanner({ treatments }: { treatments: TreatmentDto[] }) {
  const t = useTranslations("Treatment");
  const locale = useLocale();
  const until = withdrawalUntil(treatments.map(asDays), today());
  if (!until) return null;
  return <p className="rounded-lg border-2 border-red-700 bg-red-700/10 p-3 font-semibold text-red-800 dark:text-red-300">{t("withdrawal", { date: formatDay(until, locale) })}</p>;
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <span className="text-sm opacity-75">{hint}</span>}
    </div>
  );
}

export function Treatments({
  batch,
  treatments,
  medicines,
  userId,
  write,
}: {
  batch: BatchDto;
  treatments: TreatmentDto[];
  medicines: StockItemDto[]; // the farm's medicine stock items
  userId: string;
  write: Write;
}) {
  const t = useTranslations("Treatment");
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const name = (id: string) => medicines.find((m) => m.id === id)?.name ?? "—";
  const list = [...treatments].sort((a, b) => b.startOn.localeCompare(a.startOn));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="treatment-title">
      <h3 id="treatment-title" className="text-lg font-semibold">{t("title")}</h3>
      {list.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-labelledby="treatment-title">
          {list.map((x) => (
            <li key={x.id} className="flex flex-col gap-1 rounded-lg border border-current/30 p-3">
              <span className="font-semibold">{t("line", { medicine: name(x.stockItemId), start: day(x.startOn), end: day(x.endOn) })}</span>
              <span>{t("detail", { dose: x.dose, reason: x.reason, prescriber: x.prescriber })}</span>
              <span>{t("withdrawalLine", { days: String(x.withdrawalDays), date: day(x.withdrawalEndsOn) })}</span>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <TreatmentForm
          batch={batch}
          medicines={medicines.filter((m) => !m.expiresOn || m.expiresOn >= today())}
          userId={userId}
          write={write}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={secondary}>{t("add")}</button>
      )}
    </section>
  );
}

function TreatmentForm({
  batch,
  medicines,
  userId,
  write,
  onDone,
}: {
  batch: BatchDto;
  medicines: StockItemDto[];
  userId: string;
  write: Write;
  onDone: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [itemId, setItemId] = useState(medicines[0]?.id);
  const [error, setError] = useState<string>();
  const item = medicines.find((m) => m.id === itemId);
  if (!item) return <p role="alert">{t("Treatment.noMedicine")}</p>;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const quantity = parseQuantity(get("quantity"), item.unit) ?? NaN;
    const withdrawalDays = /^\d{1,3}$/.test(get("withdrawalDays")) ? Number(get("withdrawalDays")) : NaN;
    const payload = {
      id: uuidv7(),
      batchId: batch.id,
      stockItemId: item.id,
      quantity,
      dose: get("dose"),
      startOn: get("startOn") as FarmDay,
      endOn: get("endOn") as FarmDay,
      reason: get("reason"),
      prescriber: get("prescriber"),
      withdrawalDays,
    };
    if (Number.isNaN(withdrawalDays) || withdrawalDays > 365 || !payload.dose || !payload.reason || !payload.prescriber) return setError("errors.INVALID_INPUT");
    const checked = checkTreatment({ placedOn: batch.placedOn as FarmDay, status: batch.status }, payload, today()); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    setError(undefined);

    const treatment: TreatmentDto = { ...payload, withdrawalEndsOn: withdrawalEnd(payload), byUserId: userId };
    const movement: MovementDto = { id: payload.id, farmId: batch.farmId, stockItemId: item.id, kind: "consumption", quantity: -quantity, day: payload.startOn, reason: null, purchaseId: null };
    const saved = await write({ type: H.recordTreatment, payload }, [
      { entity: "treatment", id: payload.id, data: treatment },
      { entity: "movement", id: payload.id, data: movement }, // S4: the lot goes down on the phone at once
    ]);
    if (saved) onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Labelled label={t("Treatment.medicine")}>
        {(id) => (
          <select id={id} name="stockItemId" value={item.id} onChange={(e) => setItemId(e.target.value)} className={field}>
            {medicines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.lot && m.expiresOn ? t("Treatment.medicineOption", { name: m.name, lot: m.lot, date: formatDay(m.expiresOn as FarmDay, locale) }) : m.name}
              </option>
            ))}
          </select>
        )}
      </Labelled>
      <Labelled label={t("Treatment.quantity", { unit: t(`Stock.units.${item.unit}`) })}>
        {(id) => <input id={id} name="quantity" inputMode="decimal" required dir="ltr" className={field} />}
      </Labelled>
      <Labelled label={t("Treatment.dose")}>{(id) => <input id={id} name="dose" required maxLength={120} className={field} />}</Labelled>
      <Labelled label={t("Treatment.startOn")}>{(id) => <input id={id} name="startOn" type="date" defaultValue={today()} required className={field} />}</Labelled>
      <Labelled label={t("Treatment.endOn")}>{(id) => <input id={id} name="endOn" type="date" defaultValue={today()} required className={field} />}</Labelled>
      <Labelled label={t("Treatment.reason")}>{(id) => <input id={id} name="reason" required maxLength={200} className={field} />}</Labelled>
      <Labelled label={t("Treatment.prescriber")}>{(id) => <input id={id} name="prescriber" required maxLength={120} className={field} />}</Labelled>
      <Labelled label={t("Treatment.withdrawalDays")} hint={t("Treatment.withdrawalHint")}>
        {(id) => <input id={id} name="withdrawalDays" inputMode="numeric" pattern="\d{1,3}" required dir="ltr" className={field} />}
      </Labelled>
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Treatment.save")}</button>
        <button type="button" onClick={onDone} className={secondary}>{t("Treatment.cancel")}</button>
      </div>
    </form>
  );
}

export function VetVisits({ batch, visits, userId, write }: { batch: BatchDto; visits: VetVisitDto[]; userId: string; write: Write }) {
  const t = useTranslations();
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const list = [...visits].sort((a, b) => b.on.localeCompare(a.on));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const payload = { id: uuidv7(), batchId: batch.id, on: get("on") as FarmDay, vetName: get("vetName"), notes: get("notes") };
    if (!payload.vetName) return setError("errors.INVALID_INPUT");
    const checked = checkBatchDay({ placedOn: batch.placedOn as FarmDay, status: batch.status }, payload.on, today()); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    setError(undefined);
    const visit: VetVisitDto = { ...payload, byUserId: userId };
    if (await write({ type: H.recordVetVisit, payload }, [{ entity: "vetVisit", id: payload.id, data: visit }])) setAdding(false);
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="visit-title">
      <h3 id="visit-title" className="text-lg font-semibold">{t("VetVisit.title")}</h3>
      {list.length === 0 ? (
        <p>{t("VetVisit.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-labelledby="visit-title">
          {list.map((v) => (
            <li key={v.id} className="flex flex-col gap-1 rounded-lg border border-current/30 p-3">
              <span className="font-semibold">{t("VetVisit.line", { date: formatDay(v.on as FarmDay, locale), vet: v.vetName })}</span>
              {v.notes && <span className="whitespace-pre-line">{v.notes}</span>}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Labelled label={t("VetVisit.on")}>{(id) => <input id={id} name="on" type="date" defaultValue={today()} required className={field} />}</Labelled>
          <Labelled label={t("VetVisit.vet")}>{(id) => <input id={id} name="vetName" required maxLength={120} className={field} />}</Labelled>
          <Labelled label={t("VetVisit.notes")}>{(id) => <textarea id={id} name="notes" rows={3} maxLength={2000} className={field} />}</Labelled>
          {error && <p role="alert">{t(error)}</p>}
          <div className="flex gap-3">
            <button type="submit" className={primary}>{t("VetVisit.save")}</button>
            <button type="button" onClick={() => setAdding(false)} className={secondary}>{t("VetVisit.cancel")}</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={secondary}>{t("VetVisit.add")}</button>
      )}
    </section>
  );
}
