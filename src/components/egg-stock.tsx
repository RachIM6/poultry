"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { v7 as uuidv7 } from "uuid";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { dataTable, dataTableWrap, num, sectionTitle, split, formActions } from "@/components/layout";
import { Pager } from "@/components/pager";
import { pageOf, TABLE_PAGE } from "@/components/paging";
import { useInline } from "@/components/focus";
import { Sheet } from "@/components/sheet";
import { card, danger, field, ghost, primary, primarySm, secondarySm } from "@/components/ui";
import { can } from "@/lib/permissions";
import { eggWithdrawalWindows, type TreatmentDto } from "@/modules/health/shared";
import type { BuyerDto, SaleDto } from "@/modules/sales/shared";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay } from "@/lib/format";
import { formatDayShort } from "@/lib/format-day";
import { daysBetween, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
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
// computed on the phone from its records, offline. tasks/plan-ui-cleanup.md: « Vendre des œufs » is the page header's
// action; the sale, a grading and a discard open in a sheet; the lots are a table, newest first, paged (`?page=`).

const EggSaleForm = dynamic(() => import("@/components/egg-sale").then((m) => m.EggSaleForm));
const today = () => farmDayOf(new Date());
const TRAY = 30; // display only (MQ8): eggs are counted one by one
const FOLD_AFTER = 7; // display only: downgraded eggs laid longer ago fold under the recent lots
/** A cell shown from lg only: on the phone its content is in the row's first cell. */
const wide = "hidden lg:table-cell";

/** Into the page header's actions (the shell's `<span id="actions">`): the opener needs the screen's data and state. */
function HeaderActions({ children }: { children: ReactNode }) {
  const slot = document.getElementById("actions");
  return slot && createPortal(children, slot);
}

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
  // "sell", or "grade:" / "discard:" and the lot's key: the open sheet; on close the focus goes back to its opener
  const { open: action, opener, close } = useInline<string>();
  const [message, setMessage] = useState<string>();
  const search = useSearchParams();
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
  const withholding = lots.some((l) => withheldUntil(l) !== undefined);
  const old = (l: Lot) => l.item === "downgraded" && daysBetween(l.laidOn as FarmDay, today()) > FOLD_AFTER;
  const newest = [...lots].sort((x, y) => y.laidOn.localeCompare(x.laidOn)); // sold oldest first, read newest first
  const [recent, folded] = [newest.filter((l) => !old(l)), newest.filter(old)];
  const page = pageOf(search.get("page") ?? undefined, recent.length, TABLE_PAGE);
  const lotLine = (l: Lot) => t("EggStock.lot", { day: formatDayShort(l.laidOn, locale, today()), house: house(l.batchId), item: itemName(l.item), eggs: formatCount(l.eggs) });
  const kind = action?.startsWith("grade:") ? "grade" : "discard";
  const acted = lots.find((l) => action === `${kind}:${keyOf(l)}`);
  const seller = can({ userId, organizationId, role }, "sales.manage");
  const foldedTitle = t("EggStock.folded", { days: String(FOLD_AFTER), n: formatCount(folded.reduce((n, l) => n + l.eggs, 0)) });

  const save = async (mutation: { type: string; payload: { id: string } }, entity: string, data: unknown) => saveAll(mutation, [{ entity, id: mutation.payload.id, data }]);
  const saveAll = async (mutation: { type: string; payload: unknown }, recs: { entity: string; id: string; data: unknown }[]) => {
    try {
      await writeLocal(db, mutation, recs);
      setMessage("Farms.saved");
      close();
    } catch {
      setMessage("Farms.saveFailed");
    }
  };

  return (
    <>
      {/* SPEC-m3 V6; SPEC-finance FC7: workers record the eggs taken home, without a price (I5) */}
      {can({ userId, organizationId, role }, "eggs.record") && total > 0 && (
        <HeaderActions>
          <button type="button" aria-haspopup="dialog" className={primarySm} {...opener("sell")}>{t(seller ? "EggSale.open" : "EggSale.consume")}</button>
        </HeaderActions>
      )}
      <Sheet open={action === "sell"} onClose={close} title={t(seller ? "EggSale.open" : "EggSale.consume")}>
        <EggSaleForm
          batches={batches}
          lots={lots}
          buyers={of<BuyerDto>("buyer")}
          sales={of<SaleDto>("sale")}
          seller={seller}
          treatments={treatments}
          itemName={itemName}
          onSave={saveAll}
          onCancel={close}
        />
      </Sheet>
      <Sheet
        open={!!acted}
        onClose={close}
        title={acted && <>{t(kind === "grade" ? "EggStock.grade" : "EggStock.discard")}<span className="block text-sm font-normal text-ink-2">{lotLine(acted)}</span></>}
      >
        {acted && kind === "grade" && (
          <GradeForm lot={acted} grades={grades} lots={lots} onCancel={close} onSave={(grading) => save({ type: M.gradeEggs, payload: grading }, "eggGrading", grading)} />
        )}
        {acted && kind === "discard" && (
          <DiscardForm lot={acted} lots={lots} onCancel={close} onSave={(d) => save({ type: M.discardEggs, payload: d }, "eggDiscard", d)} />
        )}
      </Sheet>
      {farms.length > 1 && (
        <select aria-label={t("EggStock.farm")} value={farm?.id} onChange={(e) => setFarmId(e.target.value)} className={`${field} lg:max-w-sm`}>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
      {message && <p role="status" className="rounded-2xl bg-olive-soft p-3 text-olive">{t(message)}</p>}
      <p className="text-xl font-semibold">{t("EggStock.headline", { eggs: formatCount(total), trays: trays(total) })}</p>

      {/* Wide screens: the two summaries side by side, then the lots as a table. */}
      <div className={split}>
        <section className={card} aria-labelledby="by-item">
          <h2 id="by-item" className={sectionTitle}>{t("EggStock.byItem")}</h2>
          <ul className="flex flex-col gap-1">
            {/* A grade with no egg in stock says nothing: left out */}
            {(["ungraded", "downgraded", ...grades.map((g) => `grade:${g.id}` as const).filter((g) => (byItem[g] ?? 0) > 0)] as EggItem[]).map((item) => (
              <li key={item} className="flex justify-between gap-3">
                <span>{itemName(item)}</span>
                <span>{t("EggStock.eggsTrays", { eggs: formatCount(byItem[item] ?? 0), trays: trays(byItem[item] ?? 0) })}</span>
              </li>
            ))}
          </ul>
          {grades.some((g) => g.minGrams === null) && <p className="text-sm text-muted">{t("EggStock.limitsPending")}</p>}
        </section>

        <section className={card} aria-labelledby="by-age">
          <h2 id="by-age" className={sectionTitle}>{t("EggStock.byAge")}</h2>
          <ul className="flex flex-col gap-1">
            {AGE_BUCKETS.map((b) => (
              <li key={b} className="flex justify-between gap-3">
                <span>{t(`EggStock.ages.${b}`)}</span>
                <b>{formatCount(stockByAge(lots, today())[b])}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="lots">
        <h2 id="lots" className={sectionTitle}>{t("EggStock.lots")}</h2>
        {lots.length === 0 ? <p>{t("EggStock.none")}</p> : (
          <>
            {recent.length > 0 && lotTable(recent.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE), { "aria-labelledby": "lots" })}
            <Pager page={page} size={TABLE_PAGE} total={recent.length} href={(n) => ({ pathname: "/eggs", query: { page: n } })} />
            {/* The downgraded eggs of more than a week ago, still to sell or discard: folded, not row after row */}
            {folded.length > 0 && (
              <details className="flex flex-col gap-3">
                <summary className="disclosure text-ink-2">{foldedTitle}</summary>
                {lotTable(folded, { "aria-label": foldedTitle })}
              </details>
            )}
          </>
        )}
      </section>
    </>
  );

  function lotTable(list: Lot[], name: { "aria-labelledby": string } | { "aria-label": string }) {
    const badge = (until: FarmDay) => <span className="inline-block rounded-xl bg-alert-soft px-2 py-0.5 text-sm font-semibold text-alert-fg">{t("EggStock.withheld", { day: formatDay(until, locale) })}</span>;
    return (
      <div className={dataTableWrap}>
        <table className={dataTable} {...name}>
          <thead>
            <tr>
              <th>{t("EggStock.colDay")}</th>
              <th className={wide}>{t("EggStock.colHouse")}</th>
              <th className={wide}>{t("EggStock.colItem")}</th>
              <th className={num}>{t("EggStock.colEggs")}</th>
              {/* Only while a lot is in a withdrawal: an always-empty column says nothing */}
              {withholding && <th className={wide}>{t("EggStock.colWithheld")}</th>}
              <th><span className="sr-only">{t("EggStock.colActions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {list.map((l) => {
              const until = withheldUntil(l);
              return (
                <tr key={keyOf(l)}>
                  <td>
                    <span className="whitespace-nowrap">{formatDayShort(l.laidOn, locale, today())}</span>
                    {/* the phone: the house and the item under the day */}
                    <span className="block text-ink-2 lg:hidden">{house(l.batchId)} · {itemName(l.item)}</span>
                    {until && <span className="mt-1 block lg:hidden">{badge(until)}</span>}
                  </td>
                  <td className={wide}>{house(l.batchId)}</td>
                  <td className={wide}>{itemName(l.item)}</td>
                  <td className={num}>{formatCount(l.eggs)}</td>
                  {withholding && <td className={wide}>{until && badge(until)}</td>}
                  <td>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {l.item === "ungraded" && grades.length > 0 && (
                        <button type="button" aria-haspopup="dialog" className={secondarySm} {...opener(`grade:${keyOf(l)}`)}>{t("EggStock.grade")}</button>
                      )}
                      <button type="button" aria-haspopup="dialog" className={`${ghost} min-w-11`} {...opener(`discard:${keyOf(l)}`)}>{t("EggStock.discard")}</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
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
      <span className={formActions}>
        <button type="submit" className={primary}>{t("EggStock.saveGrading")}</button>
        <button type="button" className={`${ghost} min-w-11`} onClick={onCancel}>{t("Closing.cancel")}</button>
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
      <span className={formActions}>
        <button type="submit" className={primary}>{t("EggStock.saveDiscard")}</button>
        <button type="button" className={`${ghost} min-w-11`} onClick={onCancel}>{t("Closing.cancel")}</button>
      </span>
    </form>
  );
}
