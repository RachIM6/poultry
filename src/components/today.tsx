"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ageText } from "@/components/batch-age";
import { BatchStrip, stripDays } from "@/components/batch-strip";
import { card } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay, formatDecimal, formatKg, formatPercent } from "@/lib/format";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import { ageOn, birdsOnHand, birdsStarted, houseFigure, houseWeight, layingVersusStandard, type BatchDto, type DailyEntryDto, type SoldBirdsDto, type WeighingDto } from "@/modules/flock/shared";
import { eggsIn, layerKpis, type EggCollectionDto } from "@/modules/eggs/shared";
import { statusOn, withdrawalUntil, type TreatmentDto, type VaccinationDto } from "@/modules/health/shared";
import { SyncBadge } from "@/components/sync-status";
import { cachedReference, currentScope, localDb, scopeKey } from "@/offline/db";

// tasks/plan-ui.md U3, Today.dc.html: the home screen. A dark header with each open batch's 42-day strip, then the
// day's tasks: today's entry, vaccines due, missing days, a withdrawal in progress. Read from the phone's database.

const task = "flex items-center gap-3.5 rounded-[18px] p-4";
const icon = "grid size-12 shrink-0 place-items-center rounded-[14px]";
const ICONS = {
  entry: "M4 5h16M4 12h16M4 19h10",
  vaccine: "M17 3l4 4M19 5l-9.5 9.5M14 6l4 4M5 15l4 4M7 13l-4.5 4.5 4 4L11 17",
  missing: "M12 8v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
};
const Icon = ({ d }: { d: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** The offline shell (/today): the scope remembered by the last online visit, like /batches. */
export function TodayShell() {
  const t = useTranslations("Sync");
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return null; // reading the phone's storage
  if (scope === null) {
    return (
      <main className="mx-auto w-full max-w-xl p-5">
        <p>
          {t("signedOut")} <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
        </p>
      </main>
    );
  }
  return <Today key={scopeKey(scope)} userId={scope.userId} organizationId={scope.organizationId} sync={<SyncBadge {...scope} />} alert={null} />;
}

export function Today({ title, userId, organizationId, sync, alert, money = null }: { title?: string; userId: string; organizationId: string; sync: ReactNode; alert: ReactNode; money?: ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "dailyEntry", "weighing", "soldBirds", "vaccination", "treatment", "eggCollection").toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  if (!records || reference === undefined) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const today = farmDayOf(new Date());
  const farms = of<FarmDto>("farm");
  const houses = of<HouseDto>("house");
  const open = of<BatchDto>("batch").filter((b) => b.status === "open").sort((a, b) => a.placedOn.localeCompare(b.placedOn));
  const entries = of<DailyEntryDto>("dailyEntry");
  const weighings = of<WeighingDto>("weighing");
  const sold = of<SoldBirdsDto>("soldBirds");
  const vaccinations = of<VaccinationDto>("vaccination");
  const treatments = of<TreatmentDto>("treatment");
  const strains = reference?.data.strains ?? [];
  const products = reference?.data.products ?? [];
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const short = new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", day: "numeric", month: "short", timeZone: "UTC" });
  const shortDay = (d: string) => short.format(new Date(`${d}T00:00:00Z`));
  const farm = farms.find((f) => f.id === open[0]?.farmId) ?? farms[0];
  const strainOf = (b: BatchDto) => strains.find((s) => s.id === b.strainId);
  // SPEC-m3 D1 (P-Owner): layers show their latest laying rate vs the standard; the headline counts yesterday's eggs.
  const collections = of<EggCollectionDto>("eggCollection");
  const yesterday = addFarmDays(today, -1);
  const eggsYesterday = collections.filter((c) => c.day === yesterday && open.some((b) => b.id === c.batchId)).reduce((n, c) => n + eggsIn(c.counts), 0);
  const laying = (b: BatchDto) =>
    layerKpis(
      { placedOn: b.placedOn as FarmDay, ageAtPlacementDays: b.ageAtPlacementDays, hensHoused: birdsStarted(b) },
      entries.filter((e) => e.batchId === b.id),
      sold.filter((s) => s.batchId === b.id),
      collections.filter((c) => c.batchId === b.id),
      today,
    ).lastDay;
  // SPEC-m3 D1: broilers, turkeys and pullets show their weight vs the standard (the weight alone until a curve is
  // loaded: OQ5), then broilers and turkeys their FCR, pullets their uniformity.
  const weight = (b: BatchDto) => {
    const w = houseWeight(b, weighings.filter((x) => x.batchId === b.id), strainOf(b)?.curves ?? []);
    if (!w) return null;
    const vs = w.standard && t("Weighing.versusStandard", { gap: formatPercent(w.standard.gapPercent, true), standard: formatKg(w.standard.grams) });
    return [t("Today.weight", { weight: formatKg(w.averageGrams) }), vs].filter(Boolean).join(" · ");
  };
  const figure = (b: BatchDto) => {
    const f = houseFigure(
      { placedOn: b.placedOn as FarmDay, birdsStarted: birdsStarted(b), dayOldWeightGrams: b.dayOldWeightGrams, ageAtPlacementDays: b.ageAtPlacementDays, species: b.species },
      entries.filter((e) => e.batchId === b.id),
      weighings.filter((w) => w.batchId === b.id),
      today,
      sold.filter((s) => s.batchId === b.id),
    );
    return f && (f.kind === "fcr" ? t("Today.fcr", { fcr: formatDecimal(f.value, 2) }) : t("Weighing.uniformity", { percent: formatPercent(f.value) }));
  };

  const batches = open.map((b) => {
    const placedOn = b.placedOn as FarmDay;
    const own = entries.filter((e) => e.batchId === b.id);
    const its = treatments.filter((x) => x.batchId === b.id);
    const until = withdrawalUntil(its.map((x) => ({ ...x, startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay })), today);
    const from = its.filter((x) => x.withdrawalEndsOn >= today).map((x) => x.startOn).sort()[0];
    const due = vaccinations.filter((v) => v.batchId === b.id && !v.done);
    const age = ageOn(placedOn, today);
    const days = stripDays({
      placedOn,
      today,
      age,
      entered: new Set(own.map((e) => e.day)),
      vaccineDays: due.map((v) => v.dueOn),
      withdrawal: until && from ? { from: from as FarmDay, to: until } : null,
      rolling: b.species !== "broiler", // SPEC-m3: long cycles show a rolling window
    });
    const birds = birdsOnHand(birdsStarted(b), own, sold.filter((s) => s.batchId === b.id));
    const house = houses.find((h) => h.id === b.houseId)?.name ?? "";
    // SPEC-m3 R5: a "non précisée" strain shows the production type instead; turkeys show their sex.
    const named = b.strainId.startsWith("unspecified-") ? t(`Types.${b.species}`) : (strainOf(b)?.name ?? b.strainId);
    const strain = b.sex && b.sex !== "mixed" ? `${named} · ${t(`Batches.sexes.${b.sex}`)}` : named;
    return { b, age, days, birds, house, strain, weight: weight(b), figure: figure(b), until, due, enteredToday: own.some((e) => e.day === today), missing: days.filter((d) => d.state === "missing") };
  });

  return (
    <>
      <header className="flex flex-col gap-[18px] rounded-b-3xl bg-ink px-5 pb-[22px] pt-5 text-shell print:hidden lg:mx-5 lg:mt-5 lg:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-sand">{new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span>
            <h1 className="text-[22px] font-semibold">{title ?? farm?.name ?? t("App.name")}</h1>
            {title && farm && farm.name !== title && <span className="text-sm text-sand">{farm.name}</span>}
          </div>
          {sync}
        </div>
        {batches.map(({ b, age, days, birds, house, strain, weight, figure, missing }) => (
          <Link key={b.id} href={{ pathname: "/batches", hash: b.id }} className="flex flex-col gap-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-lg font-semibold">{house} · {strain}</span>
              <span className="text-[15px] text-sand">{t("Today.birds", { count: formatCount(birds) })}</span>
            </span>
            <BatchStrip days={days} onDark label={t("Today.stripLabel", { day: String(age), missing: String(missing.length) })} />
            {b.species === "layer" && (() => {
              const last = laying(b);
              if (last?.layingRate == null) return null;
              const vs = layingVersusStandard(b, last.day, last.layingRate, strainOf(b)?.layingCurves ?? []); // a cache from before M3 has none
              const text = t("Today.laying", { rate: formatPercent(last.layingRate), eggs: formatCount(last.eggs) });
              return <span className="text-sm text-sand">{vs ? `${text} · ${t("Today.layingStandard", { gap: formatPercent(vs.gapPoints, true), standard: formatPercent(vs.standardPercent) })}` : text}</span>;
            })()}
            {weight && <span className="text-sm text-sand">{weight}</span>}
            {figure && <span className="text-sm text-sand">{figure}</span>}
            <span className="flex justify-between gap-3 text-sm text-sand">
              <span>{b.species === "broiler" ? t("Today.dayOf", { day: String(age), total: String(days.length) }) : ageText(t, b, today)}</span>
              <span>{missing.length > 0 ? t("Today.missingOn", { date: shortDay(missing[missing.length - 1].day) }) : t("Today.allEntered")}</span>
            </span>
          </Link>
        ))}
      </header>

      <main className="mx-auto grid w-full max-w-xl flex-1 content-start gap-6 p-5 lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex flex-col gap-3.5">
        {alert}
        {open.some((b) => b.species === "layer") && (
          <p className={`${card} flex-row items-baseline justify-between`}>
            <span className="text-ink-2">{t("Today.eggsYesterday")}</span>
            <b className="text-[22px] font-semibold">{formatCount(eggsYesterday)}</b>
          </p>
        )}
        <h2 className="text-[17px] font-semibold text-ink-2">{t("Today.tasks")}</h2>
        {batches.length === 0 && (
          <div className={card}>
            <p>{farms.length === 0 ? t("Farms.none") : t("Today.none")}</p>
            <Link href={farms.length === 0 ? "/farms" : "/batches"} className="font-semibold underline underline-offset-4">
              {farms.length === 0 ? t("Farms.title") : t("Batches.place")}
            </Link>
          </div>
        )}
        {batches.map(({ b, house, until, due, enteredToday, missing }) => (
          <section key={b.id} aria-label={house} className="flex flex-col gap-3.5">
            {until && (
              <p role="status" className="rounded-2xl bg-alert-soft p-4 text-alert-fg">
                <b className="font-semibold">{house} : </b>
                {t("Treatment.withdrawal", { date: day(until) })}
              </p>
            )}
            {enteredToday ? (
              <p className={`${task} bg-olive-soft text-olive`}>{t("Today.entryDone", { house })}</p>
            ) : (
              <Link href={{ pathname: "/batches", hash: b.id }} className={`${task} bg-chick text-ink shadow-[0_2px_0_var(--color-chick-edge)]`}>
                <span className={`${icon} bg-ink text-chick`}><Icon d={ICONS.entry} /></span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-lg font-semibold">{t("Today.entry", { house })}</span>
                  <span className="text-[15px]">{t("Today.entryHint")}</span>
                </span>
              </Link>
            )}
            {due
              .filter((v) => statusOn({ dueOn: v.dueOn as FarmDay, done: v.done }, today) !== "upcoming" || v.dueOn <= addFarmDays(today, 1))
              .map((v) => {
                const product = products.find((p) => p.id === v.productId);
                const status = statusOn({ dueOn: v.dueOn as FarmDay, done: v.done }, today);
                return (
                  <Link key={v.id} href={{ pathname: "/batches", hash: b.id }} className={`${task} bg-card`}>
                    <span className={`${icon} ${status === "late" ? "bg-brick-soft text-brick-fg" : "bg-chick-soft"}`}><Icon d={ICONS.vaccine} /></span>
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[17px] font-semibold">{product ? (locale === "ar" ? product.nameAr : product.nameFr) : v.productId}</span>
                      <span className="text-[15px] text-ink-2">
                        {t(`Vaccination.status.${status}`, { date: day(v.dueOn) })} · {house} · {t(`Protocol.methods.${v.method}`)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            {missing.length > 0 && (
              <Link href={{ pathname: "/batches", hash: b.id }} className={`${task} bg-card`}>
                <span className={`${icon} bg-brick-soft text-brick-fg`}><Icon d={ICONS.missing} /></span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[17px] font-semibold">{t("Today.missing", { count: missing.length, n: formatCount(missing.length), date: shortDay(missing[0].day) })}</span>
                  <span className="text-[15px] text-ink-2">{t("Today.missingHint", { house, day: String(missing[0].age) })}</span>
                </span>
              </Link>
            )}
          </section>
        ))}
        </div>
        {money}
      </main>
    </>
  );
}
