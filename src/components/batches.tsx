"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { formatCount } from "@/lib/format";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import { pulls } from "@/lib/sync/views";
import type { CleanoutDto } from "@/modules/biosecurity/shared";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { TreasuryAccountDto } from "@/modules/finance/shared";
import { birdsOnHand, birdsStarted, type BatchDto, type DailyEntryDto, type SoldBirdsDto, type WeighingDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto } from "@/modules/health/shared";
import type { EggCollectionDto } from "@/modules/eggs/shared";
import type { DowntimeRule } from "@/modules/planning/shared";
import type { StockItemDto } from "@/modules/inventory/shared";
import type { ProtocolDto } from "@/modules/reference-data/schema";
import dynamic from "next/dynamic";
import { ageText as batchAge } from "@/components/batch-age";
import { DayForm, type Write } from "@/components/daily-entry";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { groupRecords } from "@/offline/group";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";
import { BatchStrip, batchStrip } from "@/components/batch-strip";
import { BackLink } from "@/components/app-nav";
import { Page } from "@/components/page";
import { pickTab } from "@/components/paging";
import { card, link, primarySm, secondarySm } from "@/components/ui";

// SPEC §9.3 budget (ADR-009, T25): the day's entry loads with the page; the rest of the batch screen comes in its own
// chunks right after. The service worker precaches every chunk, so they load offline too.
const PlacementForm = dynamic(() => import("@/components/placement").then((m) => m.PlacementForm));
// tasks/plan-ui-cleanup.md batch 1: the rest of a batch's screen, and the tab bars, in one lazy group (batch-panels.tsx).
const OpenBatchCard = dynamic(() => import("@/components/batch-panels").then((m) => m.OpenBatchCard));
const BatchNotes = dynamic(() => import("@/components/batch-panels").then((m) => m.BatchNotes));
const WithdrawalBanner = dynamic(() => import("@/components/batch-panels").then((m) => m.WithdrawalBanner));
const TurkeySexes = dynamic(() => import("@/components/batch-panels").then((m) => m.TurkeySexes));
const RegisterLinks = dynamic(() => import("@/components/batch-panels").then((m) => m.RegisterLinks));
const EggCollections = dynamic(() => import("@/components/batch-panels").then((m) => m.EggCollections));
const Weighings = dynamic(() => import("@/components/batch-panels").then((m) => m.Weighings));
const TabBar = dynamic(() => import("@/components/batch-panels").then((m) => m.TabBar));
const BatchPanel = dynamic(() => import("@/components/batch-panels").then((m) => m.BatchPanel));
const ClosedBatches = dynamic(() => import("@/components/batch-panels").then((m) => m.ClosedBatches));

// SPEC B1 on the static /batches shell: from and to the phone's database (ADR-003). The one-open-batch rule is checked
// here for a quick answer and enforced by the server, which rejects the second of two phones placing offline.

const today = () => farmDayOf(new Date());
// WebBatch.dc.html: on wide screens the batch's lower sections sit in two columns; one column on the phone.
const lower = "flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6 lg:gap-y-8";

// A batch's day opens as /batches#<id>, a section of the screen as ?tab=<key> (tasks/plan-ui-cleanup.md §2.4): the path
// stays the precached shell, offline included (src/sw.ts ignores ?tab=). Both are read from the URL, as it changes.
const MOVED = "batches:tab";
const onUrlChange = (cb: () => void) => {
  for (const e of ["hashchange", "popstate", MOVED]) window.addEventListener(e, cb);
  return () => ["hashchange", "popstate", MOVED].forEach((e) => window.removeEventListener(e, cb));
};
const useHash = () => useSyncExternalStore(onUrlChange, () => decodeURIComponent(window.location.hash.slice(1)), () => "");
const useTab = () => useSyncExternalStore(onUrlChange, () => new URLSearchParams(window.location.search).get("tab"), () => null);
// A tab's link is followed in place: pushState, which Next's router keeps (no server round trip, none needed offline).
// A modified click (new tab, new window) is the link's own.
const inPlace = (e: MouseEvent) => {
  const a = (e.target as Element).closest("a");
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  window.history.pushState(null, "", a.href);
  window.dispatchEvent(new Event(MOVED));
};

// UX review B2: one title per screen, through Page: the list's, or the batch's own on its day. Until the phone's
// storage is read, the list's title (the static shell's), none on a batch's day.
export function BatchesScreen() {
  const t = useTranslations();
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  const openId = useHash();
  const waiting = <Page width="wide" title={openId ? undefined : t("Batches.title")} />;
  if (scope === undefined) return waiting;
  if (scope === null) {
    return (
      <Page width="wide" title={t("Batches.title")}>
        <p>
          {t("Sync.signedOut")} <Link href="/login" className="underline underline-offset-4">{t("Sync.login")}</Link>
        </p>
      </Page>
    );
  }
  return <Batches key={scopeKey(scope)} {...scope} openId={openId} waiting={waiting} />;
}

function Batches({ openId, waiting, ...scope }: Scope & { openId: string; waiting: ReactNode }) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  const locale = useLocale();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "dailyEntry", "weighing", "stockItem", "protocol", "vaccination", "treatment", "vetVisit", "soldBirds", "buyer", "sale", "batchCost", "eggCollection", "cleanout", "downtimeRule", "treasuryAccount").toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState<string>();
  const tab = useTab();
  const grouped = useMemo(() => groupRecords(records ?? []), [records]); // once per read, not per card
  const { of, ofBatch } = grouped;
  if (!records || reference === undefined) return waiting;

  const farms = new Map(of<FarmDto>("farm").map((f) => [f.id, f]));
  const houses = of<HouseDto>("house");
  const openFirst = (b: BatchDto) => (b.status === "open" ? 0 : 1);
  // SPEC-m3 B11: a run's open beldi bands stay together, oldest first; then the rest, latest placement first.
  const band = (b: BatchDto) => (b.status === "open" && b.species === "beldi" ? b.houseId : "");
  const batches = [...of<BatchDto>("batch")].sort(
    (x, y) => openFirst(x) - openFirst(y) || band(y).localeCompare(band(x)) || (band(x) ? x.placedOn.localeCompare(y.placedOn) : y.placedOn.localeCompare(x.placedOn)),
  );
  const strains = reference?.data.strains ?? [];
  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? "";
  const busy = new Set(batches.filter((b) => b.status === "open").map((b) => b.houseId));
  const entries = of<DailyEntryDto>("dailyEntry");
  const entriesOf = (batchId: string) => ofBatch<DailyEntryDto>("dailyEntry", batchId);
  const soldOf = (batchId: string) => ofBatch<SoldBirdsDto>("soldBirds", batchId);
  const counted = new Map<string, number>();
  const onHand = (b: BatchDto) => {
    let birds = counted.get(b.id);
    if (birds === undefined) counted.set(b.id, (birds = birdsOnHand(birdsStarted(b), entriesOf(b.id), soldOf(b.id)))); // B5: sold count too
    return birds;
  };
  // SPEC-m5 §5: the accountant's phone holds no daily entry, so no bird count, strip or batch figure is shown to them.
  const farming = pulls(role, "dailyEntry");

  // tasks/plan-ui.md U4: the 42-day strip on each card and on the batch page (Batch.dc.html).
  const vaccinationsOf = (batchId: string) => ofBatch<VaccinationDto>("vaccination", batchId);
  const stripOf = (b: BatchDto) => {
    const { age, days } = batchStrip(b, today(), { entries: entriesOf(b.id), vaccinations: vaccinationsOf(b.id), treatments: ofBatch<TreatmentDto>("treatment", b.id) });
    return { age, days, label: t("Today.stripLabel", { day: String(age), missing: String(days.filter((d) => d.state === "missing").length) }) };
  };

  const write: Write = async (mutation, recs) => {
    try {
      await writeLocal(db, mutation, recs);
      setMessage("Farms.saved");
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };

  const shown = batches.find((b) => b.id === openId);
  const ageText = (b: BatchDto) => batchAge(t, b, today());
  const strainName = (id: string) => (id.startsWith("unspecified-") ? t("Batches.unspecifiedStrain") : (strains.find((s) => s.id === id)?.name ?? id));
  const sexOf = (b: BatchDto) => (b.sex && b.sex !== "mixed" ? ` · ${t(`Batches.sexes.${b.sex}`)}` : ""); // SPEC-m3 B9
  const title = (b: BatchDto) => `${t(`Types.${b.species}`)}${sexOf(b)} · ${t("Batches.summary", { farm: farms.get(b.farmId)?.name ?? "", house: houseName(b.houseId), strain: strainName(b.strainId) })}`;
  // UX review B2, B3: a batch is named by its house and strain, its type and farm under it; typed names in <bdi> (B9).
  const heading = (b: BatchDto) => (
    <>
      <bdi>{houseName(b.houseId)}</bdi> · <bdi>{strainName(b.strainId)}</bdi>
    </>
  );
  const kind = (b: BatchDto) => (
    <>
      {t(`Types.${b.species}`)}{sexOf(b)} · <bdi>{farms.get(b.farmId)?.name ?? ""}</bdi>
    </>
  );
  const dayPage = (b: BatchDto, children: ReactNode) => (
    <Page width="wide" back={<BackLink href="#" label={t("Day.back")} />} title={heading(b)} subtitle={kind(b)} actions={<RegisterLinks batchId={b.id} scope={scope} />}>
      {children}
    </Page>
  );
  // tasks/plan-ui-cleanup.md §4: under the batch's card and alerts, one section at a time; each loads its own chunks.
  const tabBar = (b: BatchDto, keys: readonly string[], current: string) =>
    keys.length > 1 && (
      <TabBar
        follow={inPlace}
        label={t("Batches.tabs.label")}
        current={current}
        tabs={keys.map((key) => ({ key, label: t(`Batches.tabs.${key}`), href: { pathname: "/batches", query: { tab: key }, hash: b.id } }))}
      />
    );
  const panel = (b: BatchDto, tab: string) => (
    <BatchPanel
      tab={tab}
      batch={b}
      batches={batches}
      houses={houses}
      farms={farms}
      strains={strains}
      products={reference?.data.products ?? []}
      title={title(b)}
      onHand={onHand(b)}
      farming={farming}
      scope={scope}
      records={grouped}
      write={write}
    />
  );
  const status = message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>;
  const nextVaccine = (batchId: string) => {
    const v = vaccinationsOf(batchId).filter((x) => !x.done).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
    if (!v) return null;
    const p = reference?.data.products.find((x) => x.id === v.productId);
    return `${p ? (locale === "ar" ? p.nameAr : p.nameFr) : v.productId} · ${t("Batches.age", { age: String(v.dayOfAge) })}`;
  };
  if (shown?.status === "closed") {
    const keys = can(scope, "sales.manage") ? (["bilan", "ventes"] as const) : (["bilan"] as const);
    const current = pickTab(keys, tab);
    return dayPage(
      shown,
      <>
        {status}
        {tabBar(shown, keys, current)}
        {panel(shown, current)}
      </>,
    );
  }

  const open = shown;
  if (open && !farming) return dayPage(open, <p className="text-sm text-ink-2">{t("Batches.noFarming")}</p>);
  if (open) {
    const record = can(scope, "flock.record");
    const eggs = open.species === "layer" && can(scope, "eggs.record");
    // The day's entry first, for whoever enters it; a vet starts on health and reads the weighings with the figures.
    const keys = [
      ...(record || eggs ? ["saisie"] : []),
      "sante",
      ...(record || can(scope, "flock.manage") ? ["ventes"] : []),
      "indicateurs",
      ...(can(scope, "flock.manage") ? ["gestion"] : []),
    ] as [string, ...string[]];
    const current = pickTab(keys, tab);
    return dayPage(
      open,
      <>
        <OpenBatchCard
          strip={stripOf(open)}
          ageLabel={open.species === "broiler" ? undefined : ageText(open)} // SPEC-m3: weeks for the long cycles
          birds={t("Day.onHand", { birds: formatCount(onHand(open)) })}
          next={nextVaccine(open.id)}
        />
        {open.sex && open.sex !== "mixed" && <TurkeySexes batch={open} batches={batches} entries={entries} weighings={of<WeighingDto>("weighing")} sold={of<SoldBirdsDto>("soldBirds")} />}
        {/* the alerts stay above the tabs; the density goes with the figures */}
        <BatchNotes batch={open} areaM2={undefined} claimPermille={farms.get(open.farmId)?.doaClaimThresholdPermille} />
        <WithdrawalBanner treatments={ofBatch<TreatmentDto>("treatment", open.id)} />
        {status}
        {tabBar(open, keys, current)}
        {current === "saisie" ? (
          <div className={lower}>
            {record && (
              <DayForm
                batch={open}
                entries={entriesOf(open.id)}
                sold={soldOf(open.id)}
                feedItems={of<StockItemDto>("stockItem").filter((i) => i.farmId === open.farmId && i.kind === "feed")}
                write={write}
              />
            )}
            {eggs && (
              <div className="flex flex-col gap-5">
                <Link href="/eggs" className={link}>{t("EggStock.title")}</Link>
                <EggCollections batch={open} collections={ofBatch<EggCollectionDto>("eggCollection", open.id)} write={write} />
              </div>
            )}
            {record && (
              <Weighings batch={open} weighings={ofBatch<WeighingDto>("weighing", open.id)} curves={strains.find((s) => s.id === open.strainId)?.curves ?? []} write={write} />
            )}
          </div>
        ) : (
          panel(open, current)
        )}
      </>,
    );
  }

  const protocols = [...of<ProtocolDto>("protocol")].sort((x, y) => x.name.localeCompare(y.name));
  const placed = (ok: boolean) => {
    setMessage(ok ? "Farms.saved" : "Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    if (ok) setPlacing(false);
  };

  // UX review A5: placing a batch is the screen's secondary action, beside its title; each card's entry stays primary.
  const placeable = can(scope, "flock.manage") && houses.length > 0 && strains.length > 0;
  // tasks/plan-ui-cleanup.md §4: the batches in progress first; the closed ones in their own tab, one line each.
  const running = batches.filter((b) => b.status === "open");
  const closed = batches.filter((b) => b.status === "closed");
  const listTab = closed.length > 0 ? pickTab(["open", "closed"], tab) : "open";
  // A batch opens on its first tab, whichever tab the list or the last batch was on.
  const dayOf = (b: BatchDto) => `/${locale}/batches#${b.id}`;
  return (
    <Page
      width="wide"
      title={t("Batches.title")}
      actions={placeable && !placing && <button type="button" aria-expanded={false} onClick={() => setPlacing(true)} className={secondarySm}>{t("Batches.place")}</button>}
      nav={
        closed.length > 0 && (
          <TabBar
            follow={inPlace}
            label={t("Batches.tabs.listLabel")}
            current={listTab}
            tabs={(["open", "closed"] as const).map((key) => ({ key, label: t(`Batches.tabs.${key}`), count: (key === "open" ? running : closed).length, href: { pathname: "/batches", query: { tab: key } } }))}
          />
        )
      }
    >
      {status}
      {/* the placement form takes its fields two by two from lg (placement.tsx) */}
      {placeable && placing && (
        <div className="flex flex-col gap-5 lg:max-w-4xl">
          <PlacementForm
            houses={houses.map((h) => ({
              ...h,
              label: `${farms.get(h.farmId)?.name ?? ""} · ${h.name}`,
              busy: busy.has(h.id),
              open: running.filter((b) => b.houseId === h.id),
            }))}
            downtime={{ batches, cleanouts: of<CleanoutDto>("cleanout"), rules: of<DowntimeRule>("downtimeRule") }}
            strains={strains.map((s) => ({ id: s.id, name: strainName(s.id), productionTypes: s.productionTypes ?? ["broiler"] }))}
            protocols={protocols}
            db={db}
            cashBoxes={can(scope, "finance.record") ? of<TreasuryAccountDto>("treasuryAccount").filter((a) => a.kind === "cash") : undefined} // SPEC-finance §9
            onPlaced={placed}
            onCancel={() => setPlacing(false)}
          />
        </div>
      )}
      {!farming && batches.length > 0 && <p className="text-sm text-ink-2">{t("Batches.noFarming")}</p>}
      {batches.length === 0 ? (
        <p>{t("Batches.none")}</p>
      ) : listTab === "closed" ? (
        <ClosedBatches
          label={t("Batches.tabs.closed")}
          rows={closed.map((b) => ({ href: dayOf(b), name: heading(b), kind: kind(b), closedOn: b.closedOn ?? b.placedOn }))}
          follow={inPlace}
        />
      ) : running.length === 0 ? (
        <p>{t("Batches.noneOpen")}</p>
      ) : (
        <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start">
          {running.map((b, i) => {
            const strip = farming ? stripOf(b) : null;
            return (
              <Fragment key={b.id}>
                {farming && band(b) && (i === 0 || band(running[i - 1]) !== band(b)) ? (
                  <li className="pt-2 font-semibold lg:col-span-full">
                    {(() => {
                      const run = running.filter((x) => band(x) === band(b));
                      return t("Batches.run", { house: houseName(b.houseId), bands: String(run.length), birds: formatCount(run.reduce((n, x) => n + onHand(x), 0)) });
                    })()}
                  </li>
                ) : null}
                <li className={card}>
                  <span className="text-[17px] font-semibold">{heading(b)}</span>
                  <span className="text-sm text-ink-2">{kind(b)}</span>
                  {/* B3: the day beside the strip, « Jour 24 / 42 » (weeks for the long cycles, SPEC-m3) */}
                  <span className="flex items-center gap-3">
                    {strip && <span className="min-w-0 flex-1"><BatchStrip {...strip} /></span>}
                    <span className="shrink-0 font-semibold">{strip && b.species === "broiler" ? `${ageText(b)} / ${strip.days.length}` : ageText(b)}</span>
                  </span>
                  <span className="text-sm text-muted">{t("Batches.chicks", { chicks: formatCount(b.chicksPlaced), doa: formatCount(b.deadOnArrival) })}</span>
                  {farming && <span>{t("Day.onHand", { birds: formatCount(onHand(b)) })}</span>}
                  {can(scope, "flock.record") ? (
                    <a href={dayOf(b)} onClick={inPlace} className={`${primarySm} mt-2`}>{t("Day.open")}</a>
                  ) : (
                    <a href={dayOf(b)} onClick={inPlace} className={link}>{t("Batches.view")}</a> // a vet or an accountant reads it, enters no day
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
      {can(scope, "flock.manage") &&
        (houses.length === 0 ? (
          <p>
            {t("Batches.noHouse")} <Link href="/farms" className="underline underline-offset-4">{t("Farms.title")}</Link>
          </p>
        ) : strains.length === 0 ? (
          <p>{t("Protocol.noReference")}</p> // strains come with the reference data, after one sync online
        ) : null)}
    </Page>
  );
}
