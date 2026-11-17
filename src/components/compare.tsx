"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { field } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatDay, formatDecimal, formatKg, formatMoney, formatPercent } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { HouseDto } from "@/modules/farm-registry/schema";
import { birdsStarted, closedBatchFigures, type BatchDto, type DailyEntryDto, type SoldBirdsDto } from "@/modules/flock/shared";
import { PRODUCTION_TYPES, type ProductionType } from "@/modules/reference-data/shared";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { startSync } from "@/offline/sync";

// SPEC-m3 D2 on the static /compare shell (P-Compare): closed batches of one production type side by side, from the
// phone's records, offline. The cost per kg is money: absent for workers (I5).

export function CompareScreen() {
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
  return <Compare key={scopeKey(scope)} {...scope} />;
}

const COLUMNS = ["hatchery", "livability", "weight", "age", "fcr", "epef", "costPerKg", "dayOld", "day7"] as const;

function Compare({ userId, organizationId, role }: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("house", "batch", "dailyEntry", "soldBirds").toArray(), [userId, organizationId]);
  const [type, setType] = useState<ProductionType>("broiler");
  if (!records) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const houses = of<HouseDto>("house");
  const entries = of<DailyEntryDto>("dailyEntry");
  const sold = of<SoldBirdsDto>("soldBirds");
  const closed = of<BatchDto>("batch")
    .filter((b) => b.status === "closed" && b.closedOn && b.species === type)
    .sort((a, b) => (b.closedOn ?? "").localeCompare(a.closedOn ?? ""));
  const none = "—";
  const rows = closed.map((b) => {
    const f = closedBatchFigures({ ...b, closedOn: b.closedOn!, birdsStarted: birdsStarted(b) }, entries.filter((e) => e.batchId === b.id), sold.filter((s) => s.batchId === b.id));
    const cells: Record<(typeof COLUMNS)[number], string> = {
      hatchery: b.hatchery,
      livability: `${formatPercent(f.livabilityPercent)} %`,
      weight: f.avgWeightGrams === null ? none : formatKg(Math.round(f.avgWeightGrams)),
      age: t("Compare.days", { days: String(f.ageDays) }),
      fcr: f.fcr === null ? none : formatDecimal(f.fcr, 2),
      epef: f.epef === null ? none : formatDecimal(f.epef, 0),
      costPerKg: b.costPerKgCentimes ? formatMoney(BigInt(b.costPerKgCentimes)) : none,
      dayOld: b.dayOldWeightGrams === null ? none : `${b.dayOldWeightGrams} g`,
      day7: `${formatPercent(f.day7MortalityPercent)} %`,
    };
    return { b, cells, house: houses.find((h) => h.id === b.houseId)?.name ?? "" };
  });

  return (
    <>
      <label className="flex max-w-xs flex-col gap-1">
        {t("Batches.type")}
        <select value={type} onChange={(e) => setType(e.target.value as ProductionType)} className={field}>
          {PRODUCTION_TYPES.map((p) => <option key={p} value={p}>{t(`Types.${p}`)}</option>)}
        </select>
      </label>
      {rows.length === 0 ? (
        <p>{t("Compare.none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm tabular-nums">
            <caption className="mb-2 text-start font-semibold">{t("Compare.caption")}</caption>
            <thead>
              <tr className="text-muted">
                <th scope="col" className="p-2 text-start font-medium">{t("Compare.cols.batch")}</th>
                {COLUMNS.map((c) => <th key={c} scope="col" className="p-2 text-start font-medium">{t(`Compare.cols.${c}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ b, cells, house }) => (
                <tr key={b.id} className="border-t border-line">
                  <th scope="row" className="p-2 text-start font-semibold">{house} · {formatDay(b.closedOn as FarmDay, locale)}</th>
                  {COLUMNS.map((c) => <td key={c} className="p-2">{cells[c]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-muted">{t("Compare.epef")}</p>
        </div>
      )}
    </>
  );
}
