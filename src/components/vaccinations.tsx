"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { formatCount, formatDay } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import type { BatchDto } from "@/modules/flock/shared";
import { HEALTH_MUTATIONS as H, checkDone, statusOn, type VaccinationDto, type VaccinationMethod } from "@/modules/health/shared";
import type { MovementDto, StockItemDto } from "@/modules/inventory/shared";
import type { Product } from "@/modules/reference-data/schema";
import { VACCINATION_METHODS } from "@/modules/reference-data/shared";
import type { Write } from "@/components/daily-entry";

// SPEC H2 on the batch screen, offline: the batch's plan, and "mark done" with the lot it came from. The phone runs the
// same check as the server and shows the stock leaving the lot at once (S4).

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white";
const secondary = "rounded-lg border border-current/30 px-4 py-3";
const today = () => farmDayOf(new Date());

export function Vaccinations({
  batch,
  vaccinations,
  products,
  lots,
  birdsOnHand,
  userId,
  write,
}: {
  batch: BatchDto;
  vaccinations: VaccinationDto[];
  products: Product[];
  lots: StockItemDto[]; // the farm's vaccine stock items
  birdsOnHand: number;
  userId: string;
  write: Write;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [doing, setDoing] = useState<string>();
  const vaccine = (id: string) => {
    const p = products.find((x) => x.id === id);
    return p ? (locale === "ar" ? p.nameAr : p.nameFr) : id;
  };
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const plan = [...vaccinations].sort((a, b) => a.dayOfAge - b.dayOfAge || a.productId.localeCompare(b.productId));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="vaccination-title">
      <h3 id="vaccination-title" className="text-lg font-semibold">{t("Vaccination.title")}</h3>
      {plan.length === 0 ? (
        <p>{t("Vaccination.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-labelledby="vaccination-title">
          {plan.map((v) => {
            const status = statusOn({ dueOn: v.dueOn as FarmDay, done: v.done }, today());
            const lot = v.done && lots.find((l) => l.id === v.done!.stockItemId);
            return (
              <li key={v.id} className="flex flex-col gap-1 rounded-lg border border-current/30 p-3">
                <span className="font-semibold">{t("Vaccination.line", { age: String(v.dayOfAge), vaccine: vaccine(v.productId), method: t(`Protocol.methods.${v.method}`) })}</span>
                <span className={status === "late" ? "font-semibold text-red-700 dark:text-red-400" : status === "today" ? "font-semibold" : "opacity-75"}>
                  {v.done
                    ? t("Vaccination.done", { date: day(v.done.on), lot: (lot && lot.lot) || "—", doses: formatCount(v.done.doses) })
                    : t(`Vaccination.status.${status}`, { date: day(v.dueOn) })}
                </span>
                {!v.done &&
                  (doing === v.id ? (
                    <DoneForm
                      batch={batch}
                      vaccination={v}
                      lots={lots.filter((l) => (l.productId === null || l.productId === v.productId) && (!l.expiresOn || l.expiresOn >= today()))}
                      birdsOnHand={birdsOnHand}
                      userId={userId}
                      write={write}
                      onDone={() => setDoing(undefined)}
                    />
                  ) : (
                    <button type="button" onClick={() => setDoing(v.id)} className={`${secondary} mt-1`}>{t("Vaccination.markDone")}</button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

function DoneForm({
  batch,
  vaccination,
  lots,
  birdsOnHand,
  userId,
  write,
  onDone,
}: {
  batch: BatchDto;
  vaccination: VaccinationDto;
  lots: StockItemDto[];
  birdsOnHand: number;
  userId: string;
  write: Write;
  onDone: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [error, setError] = useState<string>();
  if (lots.length === 0) return <p role="alert">{t("Vaccination.noLot")}</p>;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const on = (get("on") || today()) as FarmDay;
    const doses = /^\d+$/.test(get("doses")) ? Number(get("doses")) : NaN;
    const stockItemId = get("stockItemId");
    const method = get("method") as VaccinationMethod;
    const checked = checkDone(vaccination, { placedOn: batch.placedOn as FarmDay, status: batch.status }, on, doses, today()); // as the server
    if (!checked.ok) return setError(checked.error === "INVALID_QUANTITY" ? "Batches.invalid" : `errors.${checked.error}`);
    setError(undefined);

    const done = { on, stockItemId, doses, method, byUserId: userId };
    const movement: MovementDto = { id: vaccination.id, farmId: batch.farmId, stockItemId, kind: "consumption", quantity: -doses, day: on, reason: null, purchaseId: null };
    const saved = await write({ type: H.recordVaccination, payload: { id: vaccination.id, on, stockItemId, doses, method } }, [
      { entity: "vaccination", id: vaccination.id, data: { ...vaccination, done } },
      { entity: "movement", id: vaccination.id, data: movement }, // S4: the lot goes down on the phone at once
    ]);
    if (saved) onDone();
  };

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
      <Labelled label={t("Vaccination.on")}>{(id) => <input id={id} name="on" type="date" defaultValue={today()} required className={field} />}</Labelled>
      <Labelled label={t("Vaccination.lot")}>
        {(id) => (
          <select id={id} name="stockItemId" className={field}>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lot && l.expiresOn ? t("Vaccination.lotOption", { lot: l.lot, date: formatDay(l.expiresOn as FarmDay, locale) }) : l.name}
              </option>
            ))}
          </select>
        )}
      </Labelled>
      <Labelled label={t("Vaccination.doses")}>
        {(id) => <input id={id} name="doses" inputMode="numeric" pattern="\d+" defaultValue={String(Math.max(birdsOnHand, 0))} required dir="ltr" className={field} />}
      </Labelled>
      <Labelled label={t("Protocol.method")}>
        {(id) => (
          <select id={id} name="method" defaultValue={vaccination.method} className={field}>
            {VACCINATION_METHODS.map((m) => <option key={m} value={m}>{t(`Protocol.methods.${m}`)}</option>)}
          </select>
        )}
      </Labelled>
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Vaccination.save")}</button>
        <button type="button" onClick={onDone} className={secondary}>{t("Vaccination.cancel")}</button>
      </div>
    </form>
  );
}
