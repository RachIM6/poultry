"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { formatCount, formatDay } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import type { BatchDto } from "@/modules/flock/shared";
import { HEALTH_MUTATIONS as H, checkAdd, checkDone, missingRequiredVaccines, moveLine, planFor, statusOn, type VaccinationDto, type VaccinationMethod } from "@/modules/health/shared";
import type { MovementDto, StockItemDto } from "@/modules/inventory/shared";
import type { Product, ProtocolDto } from "@/modules/reference-data/schema";
import { VACCINATION_METHODS } from "@/modules/reference-data/shared";
import type { Write } from "@/components/daily-entry";
import { useFieldError, useInline } from "@/components/focus";
import { danger, field, primary, secondary } from "@/components/ui";

// SPEC H2 on the batch screen, offline: the batch's plan, and "mark done" with the lot it came from. The phone runs the
// same check as the server and shows the stock leaving the lot at once (S4). Whoever manages health (the vet, the owner,
// a manager: SPEC-m5 PA4) also edits the plan: a farm protocol for a batch without one, a vaccine added by hand, a line
// moved or taken out. Vaccines and days always come from them, never from a default (OQ4).

const today = () => farmDayOf(new Date());
const dayOfAgeIn = (data: FormData) => {
  const raw = String(data.get("dayOfAge") ?? "").trim();
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
};
const facts = (batch: BatchDto) => ({ placedOn: batch.placedOn as FarmDay, ageAtPlacementDays: batch.ageAtPlacementDays, status: batch.status });

export function Vaccinations({
  batch,
  vaccinations,
  products,
  lots,
  birdsOnHand,
  userId,
  protocols,
  manage,
  write,
}: {
  batch: BatchDto;
  vaccinations: VaccinationDto[];
  products: Product[];
  lots: StockItemDto[]; // the farm's vaccine stock items
  birdsOnHand: number;
  userId: string;
  protocols: ProtocolDto[];
  manage: boolean; // health.manage
  write: Write;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { open: doing, opener, close } = useInline<string>(); // "done:<id>", "move:<id>", "remove:<id>" or "add"
  const vaccine = (id: string) => {
    const p = products.find((x) => x.id === id);
    return p ? (locale === "ar" ? p.nameAr : p.nameFr) : id;
  };
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const plan = [...vaccinations].sort((a, b) => a.dayOfAge - b.dayOfAge || a.productId.localeCompare(b.productId));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="vaccination-title">
      <h3 id="vaccination-title" className="text-[17px] font-semibold text-ink-2">{t("Vaccination.title")}</h3>
      {/* OQ4: a warning, never a block (arrêté 3308-17 art. 13) */}
      {batch.status === "open" &&
        missingRequiredVaccines(plan).map((r) => (
          <p key={r.disease} className="rounded-xl bg-chick-soft p-2 text-sm text-chick-fg">{t(`Vaccination.required.${r.disease}`, { source: r.source })}</p>
        ))}
      {plan.length === 0 ? (
        <>
          <p>{t("Vaccination.none")}</p>
          {manage && protocols.length > 0 && <ApplyProtocol batch={batch} protocols={protocols} write={write} />}
        </>
      ) : (
        <ul className="flex flex-col gap-3" aria-labelledby="vaccination-title">
          {plan.map((v) => {
            const status = statusOn({ dueOn: v.dueOn as FarmDay, done: v.done }, today());
            const lot = v.done && lots.find((l) => l.id === v.done!.stockItemId);
            const named = { vaccine: vaccine(v.productId), age: String(v.dayOfAge) }; // SPEC X4: each button says which line
            return (
              <li key={v.id} className="flex flex-col gap-1 rounded-2xl border border-line bg-card p-3">
                <span className="font-semibold">{t("Vaccination.line", { age: String(v.dayOfAge), vaccine: vaccine(v.productId), method: t(`Protocol.methods.${v.method}`) })}</span>
                <span className={status === "late" ? "font-semibold text-alert" : status === "today" ? "font-semibold" : "text-muted"}>
                  {v.done
                    ? t("Vaccination.done", { date: day(v.done.on), lot: (lot && lot.lot) || "—", doses: formatCount(v.done.doses) })
                    : t(`Vaccination.status.${status}`, { date: day(v.dueOn) })}
                </span>
                {!v.done &&
                  (doing === `done:${v.id}` ? (
                    <DoneForm
                      batch={batch}
                      vaccination={v}
                      lots={lots.filter((l) => (l.productId === null || l.productId === v.productId) && (!l.expiresOn || l.expiresOn >= today()))}
                      birdsOnHand={birdsOnHand}
                      userId={userId}
                      write={write}
                      onDone={close}
                    />
                  ) : doing === `move:${v.id}` ? (
                    <MoveForm batch={batch} vaccination={v} write={write} onDone={close} />
                  ) : doing === `remove:${v.id}` ? (
                    <div className="mt-2 flex flex-col gap-3">
                      <p role="alert">{t("Vaccination.removeConfirm")}</p>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className={primary}
                          onClick={async () => {
                            if (await write({ type: H.cancelVaccination, payload: { id: v.id } }, [{ entity: "vaccination", id: v.id, data: null }])) close();
                          }}
                        >
                          {t("Vaccination.removeYes")}
                        </button>
                        <button type="button" onClick={close} autoFocus className={secondary}>{t("Vaccination.cancel")}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-3">
                      <button type="button" {...opener(`done:${v.id}`)} aria-label={t("Vaccination.markDoneNamed", named)} className={secondary}>{t("Vaccination.markDone")}</button>
                      {manage && <button type="button" {...opener(`move:${v.id}`)} aria-label={t("Vaccination.moveNamed", named)} className={secondary}>{t("Vaccination.move")}</button>}
                      {manage && <button type="button" {...opener(`remove:${v.id}`)} aria-label={t("Vaccination.removeNamed", named)} className={secondary}>{t("Vaccination.remove")}</button>}
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      {manage &&
        (doing === "add" ? (
          <AddForm batch={batch} vaccines={products.filter((p) => p.kind === "vaccine")} vaccine={vaccine} write={write} onDone={close} />
        ) : (
          <button type="button" {...opener("add")} className={secondary}>{t("Vaccination.add")}</button>
        ))}
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

/** A form that cannot open, and the way back to its button. */
function Blocked({ message, onDone }: { message: string; onDone: () => void }) {
  const t = useTranslations("Vaccination");
  return (
    <div className="mt-2 flex flex-col gap-3">
      <p role="alert" className={danger}>{message}</p>
      <button type="button" onClick={onDone} autoFocus className={`${secondary} self-start`}>{t("cancel")}</button>
    </div>
  );
}

/** H1 for a batch placed without a plan: one of the farm's protocols, as the placement would have applied it. */
function ApplyProtocol({ batch, protocols, write }: { batch: BatchDto; protocols: ProtocolDto[]; write: Write }) {
  const t = useTranslations();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const protocol = protocols.find((p) => p.id === new FormData(e.currentTarget).get("protocolId"));
    if (!protocol || protocol.items.length === 0) return;
    const plan = planFor(batch.id, batch.placedOn as FarmDay, protocol.items, batch.ageAtPlacementDays);
    await write({ type: H.planVaccinations, payload: { batchId: batch.id, protocolId: protocol.id, items: protocol.items } }, plan.map((v) => ({ entity: "vaccination", id: v.id, data: v })));
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Labelled label={t("Batches.protocol")}>
        {(id) => (
          <select id={id} name="protocolId" className={field}>
            {protocols.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </Labelled>
      <button type="submit" className={primary}>{t("Vaccination.apply")}</button>
    </form>
  );
}

/** SPEC-m5 PA4: a vaccine of the catalogue on a day of age, added by hand. */
function AddForm({ batch, vaccines, vaccine, write, onDone }: { batch: BatchDto; vaccines: Product[]; vaccine: (id: string) => string; write: Write; onDone: () => void }) {
  const t = useTranslations();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  if (vaccines.length === 0) return <Blocked message={t("Protocol.noReference")} onDone={onDone} />; // the catalogue comes with one sync online

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const dayOfAge = dayOfAgeIn(data);
    if (Number.isNaN(dayOfAge)) return setError("Batches.invalid", e.currentTarget, "dayOfAge");
    const dueOn = checkAdd(facts(batch), dayOfAge); // as the server
    if (!dueOn.ok) return setError(`errors.${dueOn.error}`, e.currentTarget, dueOn.error === "DAY_BEFORE_PLACEMENT" ? "dayOfAge" : undefined);
    const line = { id: uuidv7(), batchId: batch.id, dayOfAge, productId: String(data.get("productId")), method: String(data.get("method")) as VaccinationMethod };
    const dto: VaccinationDto = { ...line, dueOn: dueOn.value, done: null };
    if (await write({ type: H.addVaccination, payload: line }, [{ entity: "vaccination", id: line.id, data: dto }])) onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Labelled label={t("Protocol.vaccine")}>
        {(id) => (
          <select id={id} name="productId" autoFocus className={field}>
            {vaccines.map((p) => <option key={p.id} value={p.id}>{vaccine(p.id)}</option>)}
          </select>
        )}
      </Labelled>
      <Labelled label={t("Protocol.day")}>{(id) => <input id={id} name="dayOfAge" inputMode="numeric" pattern="\d+" required dir="ltr" {...bad("dayOfAge")} className={field} />}</Labelled>
      <Labelled label={t("Protocol.method")}>
        {(id) => (
          <select id={id} name="method" className={field}>
            {VACCINATION_METHODS.map((m) => <option key={m} value={m}>{t(`Protocol.methods.${m}`)}</option>)}
          </select>
        )}
      </Labelled>
      {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Vaccination.addSave")}</button>
        <button type="button" onClick={onDone} className={secondary}>{t("Vaccination.cancel")}</button>
      </div>
    </form>
  );
}

/** SPEC-m5 PA4: a line not yet done, to another day of age. */
function MoveForm({ batch, vaccination, write, onDone }: { batch: BatchDto; vaccination: VaccinationDto; write: Write; onDone: () => void }) {
  const t = useTranslations();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dayOfAge = dayOfAgeIn(new FormData(e.currentTarget));
    if (Number.isNaN(dayOfAge)) return setError("Batches.invalid", e.currentTarget, "dayOfAge");
    const moved = moveLine(vaccination, facts(batch), dayOfAge); // as the server
    if (!moved.ok) return setError(`errors.${moved.error}`, e.currentTarget, moved.error === "DAY_BEFORE_PLACEMENT" ? "dayOfAge" : undefined);
    const data: VaccinationDto = { ...vaccination, dayOfAge, dueOn: moved.value.dueOn };
    if (await write({ type: H.moveVaccination, payload: { id: vaccination.id, dayOfAge } }, [{ entity: "vaccination", id: vaccination.id, data }])) onDone();
  };
  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
      <Labelled label={t("Protocol.day")}>
        {(id) => <input id={id} name="dayOfAge" inputMode="numeric" pattern="\d+" defaultValue={String(vaccination.dayOfAge)} required autoFocus dir="ltr" {...bad("dayOfAge")} className={field} />}
      </Labelled>
      {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Vaccination.moveSave")}</button>
        <button type="button" onClick={onDone} className={secondary}>{t("Vaccination.cancel")}</button>
      </div>
    </form>
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
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  if (lots.length === 0) return <Blocked message={t("Vaccination.noLot")} onDone={onDone} />;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const on = (get("on") || today()) as FarmDay;
    const doses = /^\d+$/.test(get("doses")) ? Number(get("doses")) : NaN;
    const stockItemId = get("stockItemId");
    const method = get("method") as VaccinationMethod;
    const checked = checkDone(vaccination, { placedOn: batch.placedOn as FarmDay, status: batch.status }, on, doses, today()); // as the server
    if (!checked.ok) {
      const name = checked.error === "INVALID_QUANTITY" ? "doses" : checked.error.startsWith("DAY_") ? "on" : undefined;
      return setError(checked.error === "INVALID_QUANTITY" ? "Batches.invalid" : `errors.${checked.error}`, e.currentTarget, name);
    }
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
      <Labelled label={t("Vaccination.on")}>{(id) => <input id={id} name="on" type="date" defaultValue={today()} required autoFocus {...bad("on")} className={field} />}</Labelled>
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
        {(id) => <input id={id} name="doses" inputMode="numeric" pattern="\d+" defaultValue={String(Math.max(birdsOnHand, 0))} required dir="ltr" {...bad("doses")} className={field} />}
      </Labelled>
      <Labelled label={t("Protocol.method")}>
        {(id) => (
          <select id={id} name="method" defaultValue={vaccination.method} className={field}>
            {VACCINATION_METHODS.map((m) => <option key={m} value={m}>{t(`Protocol.methods.${m}`)}</option>)}
          </select>
        )}
      </Labelled>
      {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Vaccination.save")}</button>
        <button type="button" onClick={onDone} className={secondary}>{t("Vaccination.cancel")}</button>
      </div>
    </form>
  );
}
