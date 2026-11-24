"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import dynamic from "next/dynamic";
import { card, danger, field, primary, secondary } from "@/components/ui";
import { can } from "@/lib/permissions";
import { eggWithdrawalWindows, type TreatmentDto } from "@/modules/health/shared";
import type { BuyerDto, SaleDto } from "@/modules/sales/shared";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import {
  AGE_BUCKETS,
  EGG_MUTATIONS as M,
  checkDiscard,
  checkGrading,
  eggLots,
  stockByAge,
  stockByItem,
  type EggCollectionDto,
  type EggDiscardDto,
  type EggDrawDto,
  type EggGradingDto,
  type EggItem,
  type Lot,
} from "@/modules/eggs/shared";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto } from "@/modules/flock/shared";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";

// SPEC-m3 E2–E4 on the static /eggs shell (P-EggStock): the farm's eggs by item and by age, grading and discards,
// computed on the phone from its records, offline.

const EggSaleForm = dynamic(() => import("@/components/egg-sale").then((m) => m.EggSaleForm));
const today = () => farmDayOf(new Date());
const TRAY = 30; // display only (MQ8): eggs are counted one by one

export function EggStockScreen() {
  const t = useTranslations("Sync");
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return null;
  if (scope === null) {
    return (
      <p>
        {t("signedOut")} <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
      </p>
    );
  }
  return <EggStock key={scopeKey(scope)} {...scope} />;
}

function EggStock({ userId, organizationId, role }: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "eggCollection", "eggGrading", "eggDiscard", "eggDraw", "buyer", "sale", "treatment").toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [farmId, setFarmId] = useState<string>();
  const [action, setAction] = useState<{ lot: string; kind: "grade" | "discard" | "sell" } | null>(null); // the lot's key
  const [message, setMessage] = useState<string>();
  if (!records || reference === undefined) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const farms = of<FarmDto>("farm");
  const farm = farms.find((f) => f.id === farmId) ?? farms[0];
  const batches = of<BatchDto>("batch").filter((b) => b.farmId === farm?.id && b.species === "layer");
  const mine = (x: { batchId: string }) => batches.some((b) => b.id === x.batchId);
  const collections = of<EggCollectionDto>("eggCollection").filter(mine);
  const lots = eggLots({
    collections,
    gradings: of<EggGradingDto>("eggGrading").filter(mine),
    discards: of<EggDiscardDto>("eggDiscard").filter(mine),
    drawn: of<EggDrawDto>("eggDraw").filter(mine), // V6: sold
  });
  const [selling, setSelling] = [action?.kind === "sell", (on: boolean) => setAction(on ? { lot: "", kind: "sell" } : null)];
  const grades = reference?.data.eggGrades ?? [];
  const byItem = stockByItem(lots);
  const total = lots.reduce((n, l) => n + l.eggs, 0);
  const itemName = (item: EggItem) => (item.startsWith("grade:") ? (grades.find((g) => `grade:${g.id}` === item)?.label ?? item.slice(6)) : t(`EggStock.items.${item}`));
  const trays = (eggs: number) => formatCount(Math.floor(eggs / TRAY));
  const houses = of<HouseDto>("house");
  const house = (batchId: string) => houses.find((h) => h.id === batches.find((b) => b.id === batchId)?.houseId)?.name ?? "";
  const treatments = of<TreatmentDto>("treatment");
  // V6, H7: the last day of the withdrawal a lot was laid in, if any; its eggs are discarded, never sold
  const withheldUntil = (l: Lot) =>
    eggWithdrawalWindows(treatments.filter((x) => x.batchId === l.batchId).map((x) => ({ startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay, eggWithdrawalDays: x.eggWithdrawalDays ?? null })))
      .filter((w) => w.from <= l.laidOn && l.laidOn <= w.to)
      .map((w) => w.to)
      .sort()
      .at(-1);
  const keyOf = (l: Lot) => `${l.batchId}|${l.laidOn}|${l.item}`;

  const save = async (mutation: { type: string; payload: { id: string } }, entity: string, data: unknown) => saveAll(mutation, [{ entity, id: mutation.payload.id, data }]);
  const saveAll = async (mutation: { type: string; payload: unknown }, recs: { entity: string; id: string; data: unknown }[]) => {
    try {
      await writeLocal(db, mutation, recs);
      setMessage("Farms.saved");
      setAction(null);
    } catch {
      setMessage("Farms.saveFailed");
    }
  };

  return (
    <>
      {farms.length > 1 && (
        <select aria-label={t("EggStock.farm")} value={farm?.id} onChange={(e) => setFarmId(e.target.value)} className={field}>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
      {message && <p role="status" className="rounded-2xl bg-olive-soft p-3 text-olive">{t(message)}</p>}
      <p className="text-xl font-semibold">{t("EggStock.headline", { eggs: formatCount(total), trays: trays(total) })}</p>
      {/* SPEC-m3 V6; SPEC-finance FC7: workers record the eggs taken home, without a price (I5) */}
      {can({ userId, organizationId, role }, "eggs.record") &&
        (selling ? (
          <EggSaleForm
            batches={batches}
            lots={lots}
            buyers={of<BuyerDto>("buyer")}
            sales={of<SaleDto>("sale")}
            seller={can({ userId, organizationId, role }, "sales.manage")}
            treatments={treatments}
            itemName={itemName}
            onSave={saveAll}
            onCancel={() => setSelling(false)}
          />
        ) : (
          total > 0 && <button type="button" className={primary} onClick={() => setSelling(true)}>{t(can({ userId, organizationId, role }, "sales.manage") ? "EggSale.open" : "EggSale.consume")}</button>
        ))}

      <section className={card} aria-labelledby="by-item">
        <h2 id="by-item" className="text-lg font-semibold">{t("EggStock.byItem")}</h2>
        <ul className="flex flex-col gap-1">
          {(["ungraded", "downgraded", ...grades.map((g) => `grade:${g.id}` as const)] as EggItem[]).map((item) => (
            <li key={item} className="flex justify-between gap-3">
              <span>{itemName(item)}</span>
              <span>{t("EggStock.eggsTrays", { eggs: formatCount(byItem[item] ?? 0), trays: trays(byItem[item] ?? 0) })}</span>
            </li>
          ))}
        </ul>
        {grades.some((g) => g.minGrams === null) && <p className="text-sm text-muted">{t("EggStock.limitsPending")}</p>}
      </section>

      <section className={card} aria-labelledby="by-age">
        <h2 id="by-age" className="text-lg font-semibold">{t("EggStock.byAge")}</h2>
        <ul className="flex flex-col gap-1">
          {AGE_BUCKETS.map((b) => (
            <li key={b} className="flex justify-between gap-3">
              <span>{t(`EggStock.ages.${b}`)}</span>
              <b>{formatCount(stockByAge(lots, today())[b])}</b>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="lots">
        <h2 id="lots" className="text-lg font-semibold">{t("EggStock.lots")}</h2>
        {lots.length === 0 && <p>{t("EggStock.none")}</p>}
        <ul className="flex flex-col gap-2">
          {lots.map((l) => {
            const until = withheldUntil(l);
            return (
            <li key={keyOf(l)} className={card}>
              <span>{t("EggStock.lot", { day: formatDay(l.laidOn as FarmDay, locale), house: house(l.batchId), item: itemName(l.item), eggs: formatCount(l.eggs) })}</span>
              {until && <span className="self-start rounded-2xl bg-alert-soft px-3 py-1 text-sm font-semibold text-alert-fg">{t("EggStock.withheld", { day: formatDay(until, locale) })}</span>}
              <span className="flex gap-2">
                {l.item === "ungraded" && grades.length > 0 && <button type="button" className={secondary} onClick={() => setAction({ lot: keyOf(l), kind: "grade" })}>{t("EggStock.grade")}</button>}
                <button type="button" className={secondary} onClick={() => setAction({ lot: keyOf(l), kind: "discard" })}>{t("EggStock.discard")}</button>
              </span>
              {action?.lot === keyOf(l) && action.kind === "grade" && (
                <GradeForm lot={l} grades={grades} lots={lots} onCancel={() => setAction(null)} onSave={(grading) => save({ type: M.gradeEggs, payload: grading }, "eggGrading", grading)} />
              )}
              {action?.lot === keyOf(l) && action.kind === "discard" && (
                <DiscardForm lot={l} lots={lots} onCancel={() => setAction(null)} onSave={(d) => save({ type: M.discardEggs, payload: d }, "eggDiscard", d)} />
              )}
            </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function GradeForm({ lot, grades, lots, onSave, onCancel }: { lot: Lot; grades: { id: string; label: string }[]; lots: Lot[]; onSave: (g: EggGradingDto) => void; onCancel: () => void }) {
  const t = useTranslations();
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const counts = Object.fromEntries(grades.map((g) => [g.id, Number(String(data.get(g.id) ?? "0").trim() || "0")]).filter(([, n]) => n !== 0));
    const grading: EggGradingDto = { id: uuidv7(), batchId: lot.batchId, laidOn: lot.laidOn, grades: counts };
    const checked = checkGrading(lots, grading); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    onSave(grading);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {grades.map((g) => (
        <label key={g.id} className="flex items-center justify-between gap-3">
          {t("EggStock.gradeCount", { grade: g.label })}
          <input name={g.id} inputMode="numeric" pattern="\d*" dir="ltr" className={`${field} w-28`} />
        </label>
      ))}
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <span className="flex gap-2">
        <button type="submit" className={primary}>{t("EggStock.saveGrading")}</button>
        <button type="button" className={secondary} onClick={onCancel}>{t("Closing.cancel")}</button>
      </span>
    </form>
  );
}

function DiscardForm({ lot, lots, onSave, onCancel }: { lot: Lot; lots: Lot[]; onSave: (d: EggDiscardDto) => void; onCancel: () => void }) {
  const t = useTranslations();
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const eggs = Number(String(data.get("eggs") ?? "").trim());
    const reason = String(data.get("reason") ?? "").trim();
    const discard: EggDiscardDto = { id: uuidv7(), batchId: lot.batchId, laidOn: lot.laidOn, item: lot.item, eggs, reason, day: today() };
    const checked = checkDiscard(lots, discard); // as the server
    if (!checked.ok || !reason) return setError(`errors.${checked.ok ? "INVALID_INPUT" : checked.error}`);
    onSave(discard);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        {t("EggStock.discardEggs")}
        <input name="eggs" inputMode="numeric" pattern="\d+" required dir="ltr" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        {t("EggStock.reason")}
        <input name="reason" required maxLength={200} className={field} />
      </label>
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <span className="flex gap-2">
        <button type="submit" className={primary}>{t("EggStock.saveDiscard")}</button>
        <button type="button" className={secondary} onClick={onCancel}>{t("Closing.cancel")}</button>
      </span>
    </form>
  );
}
