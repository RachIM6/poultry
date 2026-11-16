"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { BatchStrip, stripDays } from "@/components/batch-strip";
import { card } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay } from "@/lib/format";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import { ageOn, type BatchDto, type DailyEntryDto, type SoldBirdsDto } from "@/modules/flock/shared";
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

export function Today({ title, userId, organizationId, sync, alert }: { title?: string; userId: string; organizationId: string; sync: ReactNode; alert: ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "dailyEntry", "soldBirds", "vaccination", "treatment").toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  if (!records || reference === undefined) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const today = farmDayOf(new Date());
  const farms = of<FarmDto>("farm");
  const houses = of<HouseDto>("house");
  const open = of<BatchDto>("batch").filter((b) => b.status === "open").sort((a, b) => a.placedOn.localeCompare(b.placedOn));
  const entries = of<DailyEntryDto>("dailyEntry");
  const sold = of<SoldBirdsDto>("soldBirds");
  const vaccinations = of<VaccinationDto>("vaccination");
  const treatments = of<TreatmentDto>("treatment");
  const strains = reference?.data.strains ?? [];
  const products = reference?.data.products ?? [];
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const short = new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", day: "numeric", month: "short", timeZone: "UTC" });
  const shortDay = (d: string) => short.format(new Date(`${d}T00:00:00Z`));
  const farm = farms.find((f) => f.id === open[0]?.farmId) ?? farms[0];

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
    });
    const birds = b.chicksPlaced - b.deadOnArrival - sold.filter((s) => s.batchId === b.id).reduce((n, s) => n + s.birds, 0) - own.reduce((n, e) => n + e.dead + e.culled, 0);
    const house = houses.find((h) => h.id === b.houseId)?.name ?? "";
    const strain = strains.find((s) => s.id === b.strainId)?.name ?? b.strainId;
    return { b, age, days, birds, house, strain, until, due, enteredToday: own.some((e) => e.day === today), missing: days.filter((d) => d.state === "missing") };
  });

  return (
    <>
      <header className="flex flex-col gap-[18px] rounded-b-3xl bg-ink px-5 pb-[22px] pt-5 text-shell print:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-sand">{new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span>
            <h1 className="text-[22px] font-semibold">{title ?? farm?.name ?? t("App.name")}</h1>
            {title && farm && farm.name !== title && <span className="text-sm text-sand">{farm.name}</span>}
          </div>
          {sync}
        </div>
        {batches.map(({ b, age, days, birds, house, strain, missing }) => (
          <Link key={b.id} href={{ pathname: "/batches", hash: b.id }} className="flex flex-col gap-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-lg font-semibold">{house} · {strain}</span>
              <span className="text-[15px] text-sand">{t("Today.birds", { count: formatCount(birds) })}</span>
            </span>
            <BatchStrip days={days} onDark label={t("Today.stripLabel", { day: String(age), missing: String(missing.length) })} />
            <span className="flex justify-between gap-3 text-sm text-sand">
              <span>{t("Today.dayOf", { day: String(age), total: String(days.length) })}</span>
              <span>{missing.length > 0 ? t("Today.missingOn", { date: shortDay(missing[missing.length - 1].day) }) : t("Today.allEntered")}</span>
            </span>
          </Link>
        ))}
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3.5 p-5">
        {alert}
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
      </main>
    </>
  );
}
