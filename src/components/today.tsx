"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";
import { ageText } from "@/components/batch-age";
import { BatchStrip, StripLegend, stripDays } from "@/components/batch-strip";
import { card } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay, formatDecimal, formatKg, formatPercent } from "@/lib/format";
import { can } from "@/lib/permissions";
import { pulls } from "@/lib/sync/views";
import type { Role } from "@/lib/tenant";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import { ageOn, birdsOnHand, birdsStarted, houseFigure, houseWeight, layingVersusStandard, type BatchDto, type DailyEntryDto, type SoldBirdsDto, type WeighingDto } from "@/modules/flock/shared";
import { eggsIn, layerKpis, type EggCollectionDto } from "@/modules/eggs/shared";
import { statusOn, withdrawalUntil, type TreatmentDto, type VaccinationDto } from "@/modules/health/shared";
import { SyncBadge } from "@/components/sync-status";
import { homeKpis } from "@/components/today-cockpit";
import { CockpitBatches, CockpitFigures, CockpitTasks, type CockpitRow } from "@/components/today-wide";
import { cachedReference, currentScope, localDb, metaValue, scopeKey } from "@/offline/db";
import { groupRecords } from "@/offline/group";

// tasks/plan-ui.md U3, Today.dc.html: the home screen. A dark header with each open batch's 42-day strip, then the
// day's tasks: today's entry, vaccines due, missing days, a withdrawal in progress. Read from the phone's database.
// From lg, the « A · Cockpit » layout (U18, today-wide.tsx) from the same figures: the phone's parts are `lg:hidden`.

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
  return <Today key={scopeKey(scope)} userId={scope.userId} organizationId={scope.organizationId} role={scope.role} sync={<SyncBadge {...scope} />} alert={null} />;
}

export function Today({ title, userId, organizationId, role, sync, alert, money = null, cash = null }: { title?: string; userId: string; organizationId: string; role: Role; sync: ReactNode; alert: ReactNode; money?: ReactNode; cash?: ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "dailyEntry", "weighing", "soldBirds", "vaccination", "treatment", "eggCollection").toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  // Right after sign-in the phone is still empty: no "no farm yet" until the first pull has answered.
  const pulled = useLiveQuery(() => metaValue(db, "cursor").then((c) => c !== undefined), [userId, organizationId]);
  const { of, ofBatch } = useMemo(() => groupRecords(records ?? []), [records]); // once per read, not per batch
  if (!records || reference === undefined) return null;

  const scope = { userId, organizationId, role };
  const farming = pulls(role, "dailyEntry"); // SPEC-m5 §5: none on the accountant's phone, so no count, strip or figure
  const recording = can(scope, "flock.record"); // the day's entry and the days missing are the recorders' tasks
  // A partner's phone holds no egg collection (vet, accountant) or no vaccination (accountant): no figure or task to show,
  // rather than a 0 or an empty list that reads as fact.
  const counting = pulls(role, "eggCollection");
  const tasked = recording || pulls(role, "vaccination");
  const today = farmDayOf(new Date());
  const farms = of<FarmDto>("farm");
  const houses = of<HouseDto>("house");
  const open = of<BatchDto>("batch").filter((b) => b.status === "open").sort((a, b) => a.placedOn.localeCompare(b.placedOn));
  const entriesOf = (b: BatchDto) => ofBatch<DailyEntryDto>("dailyEntry", b.id);
  const soldOf = (b: BatchDto) => ofBatch<SoldBirdsDto>("soldBirds", b.id);
  const strains = reference?.data.strains ?? [];
  const products = reference?.data.products ?? [];
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const short = new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", day: "numeric", month: "short", timeZone: "UTC" });
  const shortDay = (d: string) => short.format(new Date(`${d}T00:00:00Z`));
  const farm = farms.find((f) => f.id === open[0]?.farmId) ?? farms[0];
  const strainOf = (b: BatchDto) => strains.find((s) => s.id === b.strainId);
  // SPEC-m3 D1 (P-Owner): layers show their latest laying rate vs the standard; the headline counts yesterday's eggs.
  const collectionsOf = (b: BatchDto) => ofBatch<EggCollectionDto>("eggCollection", b.id);
  const yesterday = addFarmDays(today, -1);
  const eggsYesterday = open.flatMap((b) => collectionsOf(b).filter((c) => c.day === yesterday)).reduce((n, c) => n + eggsIn(c.counts), 0);
  const laying = (b: BatchDto) =>
    layerKpis(
      { placedOn: b.placedOn as FarmDay, ageAtPlacementDays: b.ageAtPlacementDays, hensHoused: birdsStarted(b) },
      entriesOf(b),
      soldOf(b),
      collectionsOf(b),
      today,
    ).lastDay;
  // SPEC-m3 D1: broilers, turkeys and pullets show their weight vs the standard (the weight alone until a curve is
  // loaded: OQ5), then broilers and turkeys their FCR, pullets their uniformity.
  const weightOf = (b: BatchDto) => houseWeight(b, ofBatch<WeighingDto>("weighing", b.id), strainOf(b)?.curves ?? []);
  const weight = (w: ReturnType<typeof weightOf>) => {
    if (!w) return null;
    const vs = w.standard && t("Weighing.versusStandard", { gap: formatPercent(w.standard.gapPercent, true), standard: formatKg(w.standard.grams) });
    return [t("Today.weight", { weight: formatKg(w.averageGrams) }), vs].filter(Boolean).join(" · ");
  };
  const figureOf = (b: BatchDto) =>
    houseFigure(
      { placedOn: b.placedOn as FarmDay, birdsStarted: birdsStarted(b), dayOldWeightGrams: b.dayOldWeightGrams, ageAtPlacementDays: b.ageAtPlacementDays, species: b.species },
      entriesOf(b),
      ofBatch<WeighingDto>("weighing", b.id),
      today,
      soldOf(b),
    );
  const figure = (f: ReturnType<typeof figureOf>) =>
    f && (f.kind === "fcr" ? t("Today.fcr", { fcr: formatDecimal(f.value, 2) }) : t("Weighing.uniformity", { percent: formatPercent(f.value) }));
  const layingLine = (b: BatchDto) => {
    const last = laying(b);
    if (last?.layingRate == null) return null;
    const vs = layingVersusStandard(b, last.day, last.layingRate, strainOf(b)?.layingCurves ?? []); // a cache from before M3 has none
    // UX review A10: a count the headline card already gives (yesterday, this house alone) isn't repeated here.
    const repeats = counting && last.day === yesterday && last.eggs === eggsYesterday;
    const text = repeats
      ? t("Today.layingRate", { rate: formatPercent(last.layingRate) })
      : t("Today.laying", { rate: formatPercent(last.layingRate), eggs: formatCount(last.eggs) });
    return { rate: last.layingRate, text: vs ? `${text} · ${t("Today.layingStandard", { gap: formatPercent(vs.gapPoints, true), standard: formatPercent(vs.standardPercent) })}` : text };
  };

  const batches = open.map((b) => {
    const placedOn = b.placedOn as FarmDay;
    const own = entriesOf(b);
    const its = ofBatch<TreatmentDto>("treatment", b.id);
    const until = withdrawalUntil(its.map((x) => ({ ...x, startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay })), today);
    const from = its.filter((x) => x.withdrawalEndsOn >= today).map((x) => x.startOn).sort()[0];
    const due = ofBatch<VaccinationDto>("vaccination", b.id).filter((v) => !v.done);
    const shown = due
      .filter((v) => statusOn({ dueOn: v.dueOn as FarmDay, done: v.done }, today) !== "upcoming" || v.dueOn <= addFarmDays(today, 1))
      .map((v) => {
        const product = products.find((p) => p.id === v.productId);
        const status = statusOn({ dueOn: v.dueOn as FarmDay, done: v.done }, today) as "late" | "today" | "upcoming"; // not done
        return { ...v, status, name: product ? (locale === "ar" ? product.nameAr : product.nameFr) : v.productId };
      });
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
    const birds = birdsOnHand(birdsStarted(b), own, soldOf(b));
    const house = houses.find((h) => h.id === b.houseId)?.name ?? "";
    // SPEC-m3 R5: a "non précisée" strain shows the production type instead; turkeys show their sex.
    const named = b.strainId.startsWith("unspecified-") ? t(`Types.${b.species}`) : (strainOf(b)?.name ?? b.strainId);
    const strain = b.sex && b.sex !== "mixed" ? `${named} · ${t(`Batches.sexes.${b.sex}`)}` : named;
    const w = weightOf(b);
    const f = figureOf(b);
    const collected = collectionsOf(b).filter((c) => c.day === yesterday);
    const missing = days.filter((d) => d.state === "missing");
    const lay = b.species === "layer" ? layingLine(b) : null;
    // The wide row's figures inline (Main.dc.html): « 0,83 kg · IC 1,46 », « Poids moyen 0,72 kg », « Ponte 92,0 % ».
    const fig = farming && f && (f.kind === "fcr"
      ? <><abbr title={t("Today.fcrName")} className="no-underline">{t("Today.fcrShort")}</abbr> {formatDecimal(f.value, 2)}</>
      : t("Weighing.uniformity", { percent: formatPercent(f.value) }));
    const kpi = lay
      ? t("Today.layingRate", { rate: formatPercent(lay.rate) })
      : w && fig ? <>{formatKg(w.averageGrams)} · {fig}</> : w ? t("Today.weight", { weight: formatKg(w.averageGrams) }) : fig || null;
    const row: CockpitRow = {
      id: b.id,
      house,
      species: b.species,
      birds,
      enteredToday: own.some((e) => e.day === today),
      missing,
      until,
      vaccines: shown.map((v) => ({ ...v, detail: <>{t(`Vaccination.status.${v.status}`, { date: day(v.dueOn) })} · <bdi>{house}</bdi> · {t(`Protocol.methods.${v.method}`)}</> })),
      eggsYesterday: collected.length > 0 ? collected.reduce((n, c) => n + eggsIn(c.counts), 0) : null,
      strain,
      age: b.species === "broiler" ? t("Today.dayOf", { day: String(age), total: String(days.length) }) : ageText(t, b, today),
      days,
      stripLabel: t("Today.stripLabel", { day: String(age), missing: String(missing.length) }),
      missingText: missing.length > 0 ? t("Today.missingOn", { date: shortDay(missing[missing.length - 1].day) }) : null,
      withdrawalText: until && t("Today.withdrawalUntil", { date: day(until) }),
      withdrawalAlert: until && t("Treatment.withdrawal", { date: day(until) }),
      missingTask: missing.length > 0 ? { title: t("Today.missing", { count: missing.length, n: formatCount(missing.length), date: shortDay(missing[0].day) }), hint: t("Today.missingHint", { house, day: String(missing[0].age) }) } : null,
      kpi,
    };
    return { b, age, days, birds, house, strain, weight: weight(w), figure: figure(f), laying: lay?.text, until, shown, enteredToday: row.enteredToday, missing, row };
  });
  const rows = batches.map((x) => x.row);
  const kpis = homeKpis(rows, { farming, counting, tasked, recording });

  // Wide screens (U18, Main.dc.html): the title over a row of figures, then the batches beside a rail with the tasks
  // and the money, in one centred column (tasks/plan-ui.md "Desktop rules"). The phone: the dark header edge to edge
  // with the strips, the tasks under it, as before. The one exception to the 1 152 px column: from 2xl the home grows
  // to 1 600 px, so the strips use a large screen (U18).
  return (
    <div className="flex w-full flex-1 flex-col lg:mx-auto lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_340px] lg:content-start lg:items-start lg:gap-5 lg:px-4 lg:pb-10 lg:pt-7 2xl:max-w-[1600px]">
      <header className="flex flex-col gap-[18px] rounded-b-3xl bg-ink px-5 pb-[22px] pt-5 text-shell print:hidden lg:col-span-full lg:rounded-none lg:bg-transparent lg:p-0 lg:text-ink">
        <div className="flex items-start justify-between gap-3 lg:flex-wrap lg:items-end">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-sand lg:text-muted">{new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span>
            <h1 className="text-[22px] font-semibold lg:text-[26px]"><bdi>{title ?? farm?.name ?? t("App.name")}</bdi></h1>
            {title && farm && farm.name !== title && <span className="text-sm text-sand lg:text-ink-2"><bdi>{farm.name}</bdi></span>}
          </div>
          {sync}
        </div>
        {batches.map(({ b, age, days, birds, house, strain, weight, figure, laying, missing }) => (
          <Link key={b.id} href={{ pathname: "/batches", hash: b.id }} className="flex flex-col gap-3 lg:hidden">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-lg font-semibold"><bdi>{house}</bdi> · <bdi>{strain}</bdi></span>
              {farming && <span className="text-[15px] text-sand">{t("Today.birds", { count: formatCount(birds) })}</span>}
            </span>
            {farming && <BatchStrip days={days} onDark label={t("Today.stripLabel", { day: String(age), missing: String(missing.length) })} />}
            {laying && <span className="text-sm text-sand">{laying}</span>}
            {weight && <span className="text-sm text-sand">{weight}</span>}
            {farming && figure && <span className="text-sm text-sand">{figure}</span>}
            <span className="flex justify-between gap-3 text-sm text-sand">
              <span>{b.species === "broiler" ? t("Today.dayOf", { day: String(age), total: String(days.length) }) : ageText(t, b, today)}</span>
              {farming && <span>{missing.length > 0 ? t("Today.missingOn", { date: shortDay(missing[missing.length - 1].day) }) : t("Today.allEntered")}</span>}
            </span>
          </Link>
        ))}
        {farming && batches.length > 0 && <div className="lg:hidden"><StripLegend days={batches.flatMap((x) => x.days)} /></div>}
      </header>

      <CockpitFigures kpis={kpis} cash={cash} />
      <CockpitBatches rows={rows} farming={farming} />

      {/* From lg, the rail beside the batches; with none, the whole width, the money beside the empty state (U12). */}
      <main className={`mx-auto grid w-full max-w-xl flex-1 content-start gap-6 p-5 lg:mx-0 lg:max-w-none lg:items-start lg:gap-5 lg:p-0 ${rows.length > 0 ? "lg:col-start-2" : `lg:col-span-full ${money ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""}`}`}>
        <div className="flex flex-col gap-3.5">
        {alert}
        {counting && open.some((b) => b.species === "layer") && (
          <p className={`${card} flex-row items-baseline justify-between lg:hidden`}>
            <span className="text-ink-2">{t("Today.eggsYesterday")}</span>
            <b className="text-[22px] font-semibold">{formatCount(eggsYesterday)}</b>
          </p>
        )}
        {tasked && <h2 className="text-[17px] font-semibold text-ink-2 lg:hidden">{t("Today.tasks")}</h2>}
        {batches.length === 0 && pulled && (
          <div className={card}>
            <p>{farms.length === 0 ? t("Farms.none") : t("Today.none")}</p>
            {can(scope, farms.length === 0 ? "farms.manage" : "flock.manage") && (
              <Link href={farms.length === 0 ? "/farms" : "/batches"} className="font-semibold underline underline-offset-4">
                {farms.length === 0 ? t("Farms.title") : t("Batches.place")}
              </Link>
            )}
          </div>
        )}
        {tasked && batches.map(({ b, house, until, shown, enteredToday, missing }) => (
          <section key={b.id} aria-label={house} className="flex flex-col gap-3.5 lg:hidden">
            {until && (
              <p role="status" className="rounded-2xl bg-alert-soft p-4 text-alert-fg">
                <b className="font-semibold"><bdi>{house}</bdi> : </b>
                {t("Treatment.withdrawal", { date: day(until) })}
              </p>
            )}
            {!recording ? null : enteredToday ? (
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
            {shown.map((v) => (
              <Link key={v.id} href={{ pathname: "/batches", hash: b.id }} className={`${task} bg-card`}>
                <span className={`${icon} ${v.status === "late" ? "bg-brick-soft text-brick-fg" : "bg-chick-soft"}`}><Icon d={ICONS.vaccine} /></span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[17px] font-semibold">{v.name}</span>
                  <span className="text-[15px] text-ink-2">
                    {t(`Vaccination.status.${v.status}`, { date: day(v.dueOn) })} · <bdi>{house}</bdi> · {t(`Protocol.methods.${v.method}`)}
                  </span>
                </span>
              </Link>
            ))}
            {recording && missing.length > 0 && (
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
        {kpis.tasks && <CockpitTasks rows={rows} recording={recording} remaining={kpis.tasks.remaining} />}
        </div>
        {money}
      </main>
    </div>
  );
}
