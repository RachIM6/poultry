"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { useFieldError, useInline } from "@/components/focus";
import { dataTable, dataTableWrap, empty, fields2, formActions, num, sectionHead, sectionTitle, split } from "@/components/layout";
import { Field, FileUpload, Shell, of, useOnline, type Save, type Screen } from "@/components/local-screen";
import { Pager } from "@/components/pager";
import { pageOf, pickTab, TABLE_PAGE } from "@/components/paging";
import { Sheet } from "@/components/sheet";
import { Tabs } from "@/components/tabs";
import { card, danger, field, ghost, primary, primarySm, secondarySm, warn } from "@/components/ui";
import { formatCount, formatDateTime, formatDay, formatKg } from "@/lib/format";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import {
  BIOSECURITY_MUTATIONS as B,
  CLEANOUT_STEPS,
  DISPOSAL_METHODS,
  MANURE_DESTINATIONS,
  RODENT_ACTIONS,
  VISIT_PURPOSES,
  VISITOR_RECENT_FARM_HOURS,
  ZONES,
  checkDisposal,
  checkManure,
  checkStep,
  disposalGaps,
  downtimeDay,
  visitZone,
  type CleanoutDto,
  type CleanoutStepKey,
  type DisposalDto,
  type ManureRemovalDto,
  type RodentCheckDto,
  type VisitDto,
  type Zone,
} from "@/modules/biosecurity/shared";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import type { BatchDto, DailyEntryDto } from "@/modules/flock/shared";
import { parseQuantity } from "@/modules/inventory/shared";
import { downtimeOn, type DowntimeRule } from "@/modules/planning/shared";
import type { LocalRecord } from "@/offline/db";

// SPEC-m2-compliance §4 on static shells, offline: the logs a farm keeps on the phone.

const check = "flex min-h-11 items-center gap-3";

/** The farm the log is about: the only one, or a choice. */
function useFarm(records: LocalRecord[]) {
  const farms = of<FarmDto>(records, "farm").sort((x, y) => x.name.localeCompare(y.name));
  const [chosen, setChosen] = useState<string>();
  const farm = farms.find((f) => f.id === chosen) ?? farms[0];
  return { farms, farm, setFarm: setChosen };
}

function FarmPicker({ farms, farm, setFarm }: ReturnType<typeof useFarm>) {
  const t = useTranslations("Biosecurity");
  if (farms.length < 2) return null;
  return (
    <Field label={t("farm")}>
      {(id) => (
        <select id={id} value={farm?.id} onChange={(e) => setFarm(e.target.value)} className={`${field} lg:max-w-xs`}>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
    </Field>
  );
}

const log = { action: "biosecurity.record", forbidden: "Biosecurity.forbidden" } as const;

/** D6: a correction sends only the fields that changed (nothing changed, nothing sent); the phone keeps `local`. */
function correct<T extends { id: string }>(save: Save, type: string, entity: string, before: T, after: T, local: { id: string } = after) {
  const changes = Object.fromEntries(Object.entries(after).filter(([k, v]) => v !== before[k as keyof T]));
  return Object.keys(changes).length === 0 ? Promise.resolve(true) : save({ type, payload: { id: before.id, changes } }, entity, local);
}

/**
 * A record of the log, one row of its list, and its "Modifier" button that opens `form` in a sheet (tasks/plan-ui-cleanup.md
 * §2.7: a correction is occasional). Records are never deleted (D6).
 */
function Editable({ name, form, children }: { name: string; form: (close: () => void) => ReactNode; children: ReactNode }) {
  const t = useTranslations("Biosecurity");
  const { open, opener, close } = useInline<"edit">();
  return (
    <li className={logRow}>
      <span className="min-w-0 flex-1">{children}</span>
      <button type="button" aria-haspopup="dialog" {...opener("edit")} className={secondarySm} aria-label={t("editNamed", { record: name })}>
        {t("edit")}
      </button>
      <Sheet open={open === "edit"} onClose={close} title={t("editNamed", { record: name })}>{form(close)}</Sheet>
    </li>
  );
}

/** The buttons of a form; a correction can be cancelled. */
function Submit({ label, onCancel, edit = !!onCancel }: { label: string; onCancel?: () => void; edit?: boolean }) {
  const t = useTranslations("Biosecurity");
  return (
    <div className={formActions}>
      <button type="submit" className={primary}>{edit ? t("saveEdit") : label}</button>
      {onCancel && <button type="button" onClick={onCancel} className={ghost}>{t("cancel")}</button>}
    </div>
  );
}

// A log's records: dense rows in one card (tasks/plan-ui-cleanup.md §2.3), each with its "Modifier".
const logList = `${card} gap-0 py-1`;
const logRow = "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line py-2 first:border-t-0";

/** A log's section: its h2, then its content. */
function LogSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className={sectionHead}><h2 id={id} className={sectionTitle}>{title}</h2></div>
      {children}
    </section>
  );
}

/** A client list's `?page=` (§2.5): the page's rows and its pager, which keeps the page's other query. */
function usePaged<T>(rows: T[], pathname: string, query: Record<string, string> = {}) {
  const search = useSearchParams();
  const page = pageOf(search.get("page") ?? undefined, rows.length, TABLE_PAGE);
  return {
    rows: rows.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE),
    pager: <Pager page={page} size={TABLE_PAGE} total={rows.length} href={(n) => ({ pathname, query: { ...query, page: n } })} />,
  };
}

// Wide screens (tasks/plan-ui.md "Desktop rules"): a log's form, under what tops it, beside its history, which starts at
// the top. The second row takes what the history needs beyond the first, so the form stays right under its head. The
// phone: one column, in this order.
const logGrid = `${split} lg:grid-rows-[auto_1fr]`;

/** A log's two columns, in a `logGrid`. */
function Columns({ form, history }: { form: ReactNode; history: ReactNode }) {
  return (
    <>
      <div className="flex flex-col gap-5">{form}</div>
      <div className="flex flex-col gap-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">{history}</div>
    </>
  );
}

export const VisitorsScreen = () => <Shell {...log} entities={["farm", "visit"]} screen={Visitors} />;

function Visitors({ records, save }: Parameters<Screen>[0]) {
  const t = useTranslations("Visitors");
  const locale = useLocale();
  const picker = useFarm(records);
  const { farm } = picker;
  if (!farm) return <p>{t("noFarm")}</p>;
  const today = farmDayOf(new Date());
  const all = of<VisitDto>(records, "visit")
    .filter((v) => v.farmId === farm.id)
    .sort((x, y) => y.enteredAt.localeCompare(x.enteredAt));
  const visits = all.filter((v) => farmDayOf(new Date(v.enteredAt)) === today);
  return (
    <div className={logGrid}>
      <Columns
        form={
          <>
            <FarmPicker {...picker} />
            <VisitForm key={farm.id} farmId={farm.id} onSave={(v) => save({ type: B.recordVisit, payload: v }, "visit", v)} />
          </>
        }
        history={
          <>
            <LogSection title={t("today")}>
              {visits.length === 0 ? (
                <p className={empty}>{t("none")}</p>
              ) : (
                <ul className={logList} aria-label={t("today")}>
                  {visits.map((v) => (
                    <Editable
                      key={v.id}
                      name={v.visitor}
                      form={(close) => <VisitForm farmId={farm.id} visit={v} onCancel={close} onSave={async (n) => (await correct(save, B.editVisit, "visit", v, n)) && (close(), true)} />}
                    >
                      <span>{t("line", { visitor: v.visitor, time: formatDateTime(v.enteredAt, locale), zone: t(`zones.${v.zone}`) })}</span>
                    </Editable>
                  ))}
                </ul>
              )}
            </LogSection>
            <EarlierVisits visits={all.filter((v) => farmDayOf(new Date(v.enteredAt)) !== today)} />
          </>
        }
      />
    </div>
  );
}

/** §2.5: the earlier visits, paged, rather than out of reach. Read only: corrections stay with the day's own. */
function EarlierVisits({ visits }: { visits: VisitDto[] }) {
  const t = useTranslations("Visitors");
  const locale = useLocale();
  const { rows, pager } = usePaged(visits, "/visitors");
  if (rows.length === 0) return null;
  return (
    <LogSection title={t("earlier")}>
      <div className={dataTableWrap}>
        <table className={dataTable} aria-label={t("earlier")}>
          <thead>
            <tr>
              <th scope="col">{t("colWhen")}</th>
              <th scope="col">{t("visitor")}</th>
              <th scope="col">{t("purpose")}</th>
              <th scope="col">{t("zone")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td className="whitespace-nowrap">{formatDateTime(v.enteredAt, locale)}</td>
                <td>{v.visitor}</td>
                <td>{t(`purposes.${v.purpose}`)}</td>
                <td>{t(`zones.${v.zone}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </LogSection>
  );
}

function VisitForm({ farmId, visit, onSave, onCancel }: { farmId: string; visit?: VisitDto; onSave: (v: VisitDto) => Promise<boolean>; onCancel?: () => void }) {
  const t = useTranslations();
  const [recentFarm, setRecentFarm] = useState(visit?.recentFarm ?? false);
  const [zone, setZone] = useState<Zone>(visit?.zone ?? "dirty");
  const [key, setKey] = useState(0); // a new key empties the form after a save
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const allowed = visitZone({ recentFarm, zone });
    if (!allowed.ok) return setError(`errors.${allowed.error}`);
    setError(undefined);
    const saved = await onSave({
      id: visit?.id ?? uuidv7(),
      farmId,
      enteredAt: visit?.enteredAt ?? new Date().toISOString(),
      visitor: get("visitor"),
      vehicle: get("vehicle") || null,
      purpose: get("purpose") as VisitDto["purpose"],
      recentFarm,
      wheelsDisinfected: data.has("wheels"),
      footbath: data.has("footbath"),
      farmClothing: data.has("clothing"),
      zone: allowed.value,
    });
    if (saved) {
      setKey((k) => k + 1);
      setRecentFarm(false);
      setZone("dirty");
    }
  };

  return (
    // Inline, the page's job, two by two from lg; a correction, in its sheet, in one column.
    <form key={key} onSubmit={submit} className={visit ? "flex flex-col gap-3" : `${card} gap-3 ${fields2}`} aria-label={visit && t("Biosecurity.editNamed", { record: visit.visitor })}>
      <Field label={t("Visitors.visitor")}>{(id) => <input id={id} name="visitor" required maxLength={120} defaultValue={visit?.visitor} autoFocus={!!visit} className={field} />}</Field>
      <Field label={t("Visitors.vehicle")}>{(id) => <input id={id} name="vehicle" maxLength={20} dir="ltr" defaultValue={visit?.vehicle ?? ""} className={field} />}</Field>
      <Field label={t("Visitors.purpose")}>
        {(id) => (
          <select id={id} name="purpose" defaultValue={visit?.purpose} className={field}>
            {VISIT_PURPOSES.map((p) => <option key={p} value={p}>{t(`Visitors.purposes.${p}`)}</option>)}
          </select>
        )}
      </Field>
      <fieldset className="flex flex-col gap-1 lg:col-span-full">
        <legend className="font-semibold">{t("Visitors.recentTitle", { hours: VISITOR_RECENT_FARM_HOURS })}</legend>
        <label className={check}>
          <input type="checkbox" checked={recentFarm} onChange={(e) => (setRecentFarm(e.target.checked), e.target.checked && setZone("dirty"))} className="size-6" />
          {t("Visitors.recentFarm")}
        </label>
        {recentFarm && <p className={warn}>{t("Visitors.dirtyOnly")}</p>}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-semibold">{t("Visitors.checks")}</legend>
        <label className={check}><input type="checkbox" name="wheels" defaultChecked={visit?.wheelsDisinfected} className="size-6" />{t("Visitors.wheels")}</label>
        <label className={check}><input type="checkbox" name="footbath" defaultChecked={visit?.footbath} className="size-6" />{t("Visitors.footbath")}</label>
        <label className={check}><input type="checkbox" name="clothing" defaultChecked={visit?.farmClothing} className="size-6" />{t("Visitors.clothing")}</label>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-semibold">{t("Visitors.zone")}</legend>
        {ZONES.map((z) => (
          <label key={z} className={check}>
            <input type="radio" name="zone" value={z} checked={zone === z} disabled={recentFarm && z === "clean"} onChange={() => setZone(z)} className="size-6" />
            {t(`Visitors.zones.${z}`)}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className={`${danger} lg:col-span-full`}>{t(error)}</p>}
      <Submit label={t("Visitors.save")} onCancel={onCancel} />
    </form>
  );
}

// BS6–BS7: what leaves the farm. One log at a time, chosen with query tabs (?tab=, links: tasks/plan-ui-cleanup.md §2.4).
const TABS = ["dead", "manure", "rodents"] as const;
const GAP_DAYS = 14; // how far back the dead/disposed comparison looks on the phone: a screen choice, not a rule

export const DisposalScreen = () => <Shell {...log} entities={["farm", "house", "batch", "dailyEntry", "disposal", "manureRemoval", "rodentCheck"]} screen={Disposal} />;

type Choice = { id: string; label: string };

function Disposal({ records, save, db }: Parameters<Screen>[0]) {
  const t = useTranslations("Disposal");
  const locale = useLocale();
  const picker = useFarm(records);
  const tab = pickTab(TABS, useSearchParams().get("tab"));
  const { farm } = picker;
  if (!farm) return <p>{t("noFarm")}</p>;
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const houses = of<HouseDto>(records, "house").filter((h) => h.farmId === farm.id);
  const batches = of<BatchDto>(records, "batch").filter((b) => b.farmId === farm.id);
  const batchLabel = (id: string | null) => {
    const b = batches.find((x) => x.id === id);
    return b ? t("batch", { house: houses.find((h) => h.id === b.houseId)?.name ?? "—", date: day(b.placedOn) }) : null;
  };
  const choices: Choice[] = batches.filter((b) => b.status === "open").map((b) => ({ id: b.id, label: batchLabel(b.id)! }));

  // The farm, then the tabs over both columns: a tab changes the form and its history.
  return (
    <>
      <FarmPicker {...picker} />
      <Tabs label={t("tabs")} current={tab} tabs={TABS.map((k) => ({ key: k, label: t(`tab.${k}`), href: { pathname: "/disposal", query: { tab: k } } }))} />
      <div className={logGrid}>
        {tab === "dead" ? (
          <DeadBirds farmId={farm.id} records={records} batches={choices} batchLabel={batchLabel} day={day} save={save} />
        ) : tab === "manure" ? (
          <Manure farmId={farm.id} records={records} houses={houses} batches={choices} batchLabel={batchLabel} day={day} save={save} />
        ) : (
          <Rodents farmId={farm.id} records={records} houses={houses} day={day} save={save} db={db} />
        )}
      </div>
    </>
  );
}

type LogProps = { farmId: string; records: LocalRecord[]; batches: Choice[]; batchLabel: (id: string | null) => string | null; day: (d: string) => string; save: Save };

/** The open batches, and the record's own batch when it has closed since: a correction never drops it silently. */
const withBatch = (batches: Choice[], id: string | null | undefined, label: LogProps["batchLabel"]) =>
  id && !batches.some((b) => b.id === id) ? [...batches, { id, label: label(id) ?? id }] : batches;

function DeadBirds({ farmId, records, batches, batchLabel, day, save }: LogProps) {
  const t = useTranslations();
  const today = farmDayOf(new Date());
  const since = addFarmDays(today, -GAP_DAYS);
  const farmBatches = new Set(of<BatchDto>(records, "batch").filter((b) => b.farmId === farmId).map((b) => b.id));
  const disposals = of<DisposalDto>(records, "disposal").filter((d) => d.farmId === farmId);
  const mortality = of<DailyEntryDto>(records, "dailyEntry")
    .filter((e) => farmBatches.has(e.batchId) && e.day >= since)
    .map((e) => ({ day: e.day, birds: e.dead + e.culled }));
  const gaps = disposalGaps(mortality, disposals.filter((d) => d.day >= since)).filter((g) => g.dead || g.disposed);
  const recent = usePaged(disposals.sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id)), "/disposal", { tab: "dead" });

  return (
    <Columns
      form={<DisposalForm farmId={farmId} batches={batches} onSave={(d) => save({ type: B.recordDisposal, payload: d }, "disposal", d)} />}
      history={
        <>
          <LogSection title={t("Disposal.gaps", { days: GAP_DAYS })}>
            {gaps.length === 0 ? (
              <p className={empty}>{t("Disposal.noGaps")}</p>
            ) : (
              <div className={dataTableWrap}>
                <table className={dataTable} aria-label={t("Disposal.gaps", { days: GAP_DAYS })}>
                  <thead>
                    <tr>
                      <th scope="col">{t("Disposal.day")}</th>
                      <th scope="col" className={num}>{t("Disposal.dead")}</th>
                      <th scope="col" className={num}>{t("Disposal.disposed")}</th>
                      <th scope="col" className={num}>{t("Disposal.gap")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gaps.map((g) => (
                      <tr key={g.day} className={g.gap > 0 ? "font-semibold text-alert-fg" : ""}>
                        <td>{day(g.day)}</td>
                        <td className={num}>{formatCount(g.dead)}</td>
                        <td className={num}>{formatCount(g.disposed)}</td>
                        <td className={num}>{formatCount(g.gap)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </LogSection>

          {recent.rows.length > 0 && (
            <LogSection title={t("Disposal.recent")}>
              <ul className={logList} aria-label={t("Disposal.recent")}>
                {recent.rows.map((d) => (
                  <Editable
                    key={d.id}
                    name={day(d.day)}
                    form={(close) => (
                      <DisposalForm farmId={farmId} batches={withBatch(batches, d.batchId, batchLabel)} disposal={d} onCancel={close} onSave={async (n) => (await correct(save, B.editDisposal, "disposal", d, n)) && (close(), true)} />
                    )}
                  >
                    <span>
                      {t("Disposal.line", { date: day(d.day), birds: formatCount(d.birds), method: d.method === "other" ? (d.methodNote ?? "") : t(`Disposal.methods.${d.method}`) })}
                      {d.weightGrams !== null && <> · <bdi dir="ltr">{formatKg(d.weightGrams)}</bdi></>}
                      {d.batchId && ` · ${batchLabel(d.batchId) ?? ""}`}
                    </span>
                  </Editable>
                ))}
              </ul>
              {recent.pager}
            </LogSection>
          )}
        </>
      }
    />
  );
}

type FormProps<T> = { farmId: string; onSave: (r: T) => Promise<boolean>; onCancel?: () => void };

/** BS6: records a disposal, or corrects `disposal`. */
function DisposalForm({ farmId, batches, disposal, onSave, onCancel }: FormProps<DisposalDto> & { batches: Choice[]; disposal?: DisposalDto }) {
  const t = useTranslations();
  const [method, setMethod] = useState<DisposalDto["method"]>(disposal?.method ?? "incineration");
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  const [key, setKey] = useState(0);
  const today = farmDayOf(new Date());

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const birds = parseQuantity(get("birds"), "unit");
    const weightGrams = get("weight") ? parseQuantity(get("weight"), "kg") : null;
    if (birds === null || (get("weight") && weightGrams === null)) return setError("errors.INVALID_QUANTITY", e.currentTarget, birds === null ? "birds" : "weight");
    const methodNote = method === "other" ? get("methodNote") || null : null;
    const checked = checkDisposal({ method, methodNote });
    if (!checked.ok) return setError(`errors.${checked.error}`, e.currentTarget, "methodNote");
    if (get("day") > today) return setError("errors.DAY_IN_FUTURE", e.currentTarget, "day");
    setError(undefined);
    const d: DisposalDto = { id: disposal?.id ?? uuidv7(), farmId, day: get("day") || today, batchId: get("batch") || null, birds, weightGrams, method, methodNote };
    if ((await onSave(d)) && !disposal) {
      setKey((k) => k + 1);
      setMethod("incineration");
    }
  };

  return (
    <form key={key} onSubmit={submit} className={disposal ? "flex flex-col gap-3" : `${card} gap-3`}>
      <Field label={t("Disposal.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={disposal?.day ?? today} max={today} required autoFocus={!!disposal} {...bad("day")} className={field} />}</Field>
      <Field label={t("Disposal.batchField")}>
        {(id) => (
          <select id={id} name="batch" defaultValue={disposal ? (disposal.batchId ?? "") : undefined} className={field}>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            <option value="">{t("Disposal.noBatch")}</option>
          </select>
        )}
      </Field>
      <Field label={t("Disposal.birds")}>{(id) => <input id={id} name="birds" inputMode="numeric" required dir="ltr" defaultValue={disposal?.birds} {...bad("birds")} className={field} />}</Field>
      <Field label={t("Disposal.weight")}>
        {(id) => <input id={id} name="weight" inputMode="decimal" dir="ltr" defaultValue={disposal?.weightGrams != null ? String(disposal.weightGrams / 1000) : ""} {...bad("weight")} className={field} />}
      </Field>
      <Field label={t("Disposal.method")}>
        {(id) => (
          <select id={id} value={method} onChange={(e) => setMethod(e.target.value as DisposalDto["method"])} className={field}>
            {DISPOSAL_METHODS.map((k) => <option key={k} value={k}>{t(`Disposal.methods.${k}`)}</option>)}
          </select>
        )}
      </Field>
      {method === "other" && <Field label={t("Disposal.methodNote")}>{(id) => <input id={id} name="methodNote" required maxLength={200} defaultValue={disposal?.methodNote ?? ""} {...bad("methodNote")} className={field} />}</Field>}
      <p className="text-sm text-muted">{t("Disposal.sources")}</p>
      {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
      <Submit label={t("Disposal.save")} onCancel={onCancel} />
    </form>
  );
}

function Manure({ farmId, records, houses, batches, batchLabel, day, save }: LogProps & { houses: HouseDto[] }) {
  const t = useTranslations();
  const recent = usePaged(
    of<ManureRemovalDto>(records, "manureRemoval")
      .filter((r) => r.farmId === farmId)
      .sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id)),
    "/disposal",
    { tab: "manure" },
  );

  return (
    <Columns
      form={<ManureForm farmId={farmId} houses={houses} batches={batches} onSave={(r) => save({ type: B.recordManure, payload: r }, "manureRemoval", r)} />}
      history={
        <LogSection title={t("Disposal.recentManure")}>
          {recent.rows.length === 0 ? (
            <p className={empty}>{t("Disposal.noManure")}</p>
          ) : (
            <ul className={logList} aria-label={t("Disposal.recentManure")}>
              {recent.rows.map((r) => (
                <Editable
                  key={r.id}
                  name={day(r.day)}
                  form={(close) => (
                    <ManureForm farmId={farmId} houses={houses} batches={withBatch(batches, r.batchId, batchLabel)} removal={r} onCancel={close} onSave={async (n) => (await correct(save, B.editManure, "manureRemoval", r, n)) && (close(), true)} />
                  )}
                >
                  <span>
                    {t("Disposal.manureLine", { date: day(r.day), kg: formatCount(r.quantityKg), destination: t(`Disposal.destinations.${r.destination}`) })}
                    {r.recipient && ` · ${r.recipient}`}
                  </span>
                </Editable>
              ))}
            </ul>
          )}
          {recent.pager}
        </LogSection>
      }
    />
  );
}

/** BS7: records a manure removal, or corrects `removal`. */
function ManureForm({ farmId, houses, batches, removal, onSave, onCancel }: FormProps<ManureRemovalDto> & { houses: HouseDto[]; batches: Choice[]; removal?: ManureRemovalDto }) {
  const t = useTranslations();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  const [key, setKey] = useState(0);
  const [destination, setDestination] = useState<ManureRemovalDto["destination"]>(removal?.destination ?? "stored");
  const today = farmDayOf(new Date());

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const quantityKg = parseQuantity(get("quantity"), "unit");
    if (quantityKg === null) return setError("errors.INVALID_QUANTITY", e.currentTarget, "quantity");
    if (get("day") > today) return setError("errors.DAY_IN_FUTURE", e.currentTarget, "day");
    const spreadDeclared = destination === "spread" && data.get("spreadDeclared") === "on";
    const checked = checkManure({ destination, spreadDeclared }); // CQ4, the server's rule too
    if (!checked.ok) return setError(`errors.${checked.error}`, e.currentTarget, "spreadDeclared");
    setError(undefined);
    const r: ManureRemovalDto = {
      id: removal?.id ?? uuidv7(),
      farmId,
      day: get("day") || today,
      houseId: get("house") || null,
      batchId: get("batch") || null,
      quantityKg,
      destination,
      recipient: get("recipient") || null,
      spreadDeclared,
    };
    if ((await onSave(r)) && !removal) {
      setKey((k) => k + 1);
      setDestination("stored");
    }
  };

  return (
    <form key={key} onSubmit={submit} className={removal ? "flex flex-col gap-3" : `${card} gap-3`}>
      <Field label={t("Disposal.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={removal?.day ?? today} max={today} required autoFocus={!!removal} {...bad("day")} className={field} />}</Field>
      <Field label={t("Disposal.house")}>
        {(id) => (
          <select id={id} name="house" defaultValue={removal ? (removal.houseId ?? "") : undefined} className={field}>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            <option value="">{t("Disposal.noHouse")}</option>
          </select>
        )}
      </Field>
      <Field label={t("Disposal.batchField")}>
        {(id) => (
          <select id={id} name="batch" defaultValue={removal?.batchId ?? ""} className={field}>
            <option value="">{t("Disposal.noBatch")}</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("Disposal.quantity")}>{(id) => <input id={id} name="quantity" inputMode="numeric" required dir="ltr" defaultValue={removal?.quantityKg} {...bad("quantity")} className={field} />}</Field>
      <Field label={t("Disposal.destination")}>
        {(id) => (
          <select id={id} value={destination} onChange={(e) => setDestination(e.target.value as ManureRemovalDto["destination"])} className={field}>
            {MANURE_DESTINATIONS.map((k) => <option key={k} value={k}>{t(`Disposal.destinations.${k}`)}</option>)}
          </select>
        )}
      </Field>
      {destination === "spread" && (
        <label className={check}>
          <input type="checkbox" name="spreadDeclared" required defaultChecked={removal?.spreadDeclared} {...bad("spreadDeclared")} className="size-6" />
          {t("Disposal.spreadDeclared")}
        </label>
      )}
      <Field label={t("Disposal.recipient")}>{(id) => <input id={id} name="recipient" maxLength={120} defaultValue={removal?.recipient ?? ""} className={field} />}</Field>
      {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
      <Submit label={t("Disposal.saveManure")} onCancel={onCancel} />
    </form>
  );
}

// BS4–BS5: a house between two batches. The clean-out follows the house's last closed batch.
export const CleanoutScreen = () => <Shell {...log} entities={["farm", "house", "batch", "cleanout", "downtimeRule"]} screen={Cleanouts} />;

function Cleanouts(props: Parameters<Screen>[0]) {
  const { records, save } = props;
  const t = useTranslations("Cleanout");
  const locale = useLocale();
  const picker = useFarm(records);
  const { farm } = picker;
  if (!farm) return <p>{t("noFarm")}</p>;
  const today = farmDayOf(new Date());
  const day = (d: string) => formatDay(d as FarmDay, locale);
  const houses = of<HouseDto>(records, "house").filter((h) => h.farmId === farm.id).sort((x, y) => x.name.localeCompare(y.name));
  const batches = of<BatchDto>(records, "batch");
  const cleanouts = of<CleanoutDto>(records, "cleanout");
  const { minDays } = downtimeOn(of<DowntimeRule>(records, "downtimeRule"), farm.id, today); // planning's one figure (CQ3)

  return (
    <>
      <FarmPicker {...picker} />
      {houses.map((house) => {
        const last = batches.filter((b) => b.houseId === house.id).sort((x, y) => y.placedOn.localeCompare(x.placedOn))[0];
        if (!last) return null;
        const cleanout = cleanouts.find((c) => c.afterBatchId === last.id);
        const disinfectedOn = cleanout?.steps.find((s) => s.step === "disinfection")?.day ?? null;
        return (
          <section key={house.id} aria-label={house.name} className={card}>
            <h2 className={sectionTitle}>{house.name}</h2>
            {last.status === "open" ? (
              <p>{t("busy", { date: day(last.placedOn) })}</p>
            ) : !cleanout ? (
              <>
                <p>{t("after", { date: day(last.placedOn) })}</p>
                <button
                  type="button"
                  className={primarySm}
                  onClick={() => {
                    const payload = { id: uuidv7(), houseId: house.id, afterBatchId: last.id, startedOn: today };
                    const local: CleanoutDto = { ...payload, farmId: farm.id, steps: [] };
                    void save({ type: B.startCleanout, payload }, "cleanout", local);
                  }}
                >
                  {t("start")}
                </button>
              </>
            ) : (
              <>
                <p className="rounded-2xl bg-ink p-3 font-semibold text-shell" role="status">
                  {disinfectedOn
                    ? t("downtimeOf", { day: downtimeDay(disinfectedOn as FarmDay, today), min: minDays, end: day(addFarmDays(disinfectedOn as FarmDay, minDays)) })
                    : t("notDisinfected")}
                </p>
                <Steps cleanout={cleanout} day={day} save={save} />
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

function Steps({ cleanout, day, save }: { cleanout: CleanoutDto; day: (d: string) => string; save: Save }) {
  const t = useTranslations();
  const { open, opener, close } = useInline<CleanoutStepKey>();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  const today = farmDayOf(new Date());

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!open) return;
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim() || null;
    const done = cleanout.steps.find((s) => s.step === open); // marked already: this is a correction (D6)
    const step = { id: done?.id ?? uuidv7(), step: open, day: get("day") ?? today, product: get("product"), dose: get("dose"), productLot: get("productLot"), note: get("note") };
    const checked = checkStep(done ? [] : cleanout.steps, step);
    if (!checked.ok) return setError(`errors.${checked.error}`, e.currentTarget, checked.error === "DISINFECTANT_REQUIRED" ? "product" : undefined);
    if (step.day > today) return setError("errors.DAY_IN_FUTURE", e.currentTarget, "day");
    setError(undefined);
    const next: CleanoutDto = { ...cleanout, steps: done ? cleanout.steps.map((s) => (s.id === done.id ? step : s)) : [...cleanout.steps, step] };
    const saved = done
      ? await correct(save, B.editCleanoutStep, "cleanout", done, step, next)
      : await save({ type: B.recordCleanoutStep, payload: { ...step, cleanoutId: cleanout.id } }, "cleanout", next);
    if (saved) close();
  };

  const done = open && cleanout.steps.find((s) => s.step === open);
  // §2.7: a step is noted in a sheet, opened from its row; the focus goes back to that row's button.
  return (
    <>
      <ol className="flex flex-col lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6">
        {CLEANOUT_STEPS.map((key, i) => {
          const marked = cleanout.steps.find((s) => s.step === key);
          return (
            <li key={key} className="flex items-center justify-between gap-2 border-t border-line py-2">
              <span>
                <span aria-hidden="true">{marked ? "✓" : i + 1} </span>
                <span className={marked ? "font-semibold" : ""}>{t(`Cleanout.steps.${key}`)}</span>
                {marked && <span className="block text-sm text-muted">{[day(marked.day), marked.product, marked.dose, marked.productLot && t("Cleanout.lot", { lot: marked.productLot }), marked.note].filter(Boolean).join(" · ")}</span>}
              </span>
              <button
                type="button"
                aria-haspopup="dialog"
                {...opener(key, () => setError(undefined))}
                className={secondarySm}
                aria-label={marked ? t("Biosecurity.editNamed", { record: t(`Cleanout.steps.${key}`) }) : t("Cleanout.markNamed", { step: t(`Cleanout.steps.${key}`) })}
              >
                {marked ? t("Biosecurity.edit") : t("Cleanout.mark")}
              </button>
            </li>
          );
        })}
      </ol>
      <Sheet open={!!open} onClose={close} title={open ? t(`Cleanout.steps.${open}`) : ""}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label={t("Cleanout.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={done?.day ?? today} max={today} required {...bad("day")} className={field} />}</Field>
          {open === "disinfection" && (
            <>
              <Field label={t("Cleanout.product")}>{(id) => <input id={id} name="product" required maxLength={120} defaultValue={done?.product ?? ""} {...bad("product")} className={field} />}</Field>
              <Field label={t("Cleanout.dose")}>{(id) => <input id={id} name="dose" maxLength={60} defaultValue={done?.dose ?? ""} className={field} />}</Field>
              <Field label={t("Cleanout.productLot")}>{(id) => <input id={id} name="productLot" maxLength={60} dir="ltr" defaultValue={done?.productLot ?? ""} className={field} />}</Field>
            </>
          )}
          <Field label={t("Cleanout.note")}>{(id) => <input id={id} name="note" maxLength={200} defaultValue={done?.note ?? ""} className={field} />}</Field>
          {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
          <Submit label={t("Cleanout.save")} edit={!!done} onCancel={close} />
        </form>
      </Sheet>
    </>
  );
}

// BS8: rodent control with physical proof (law 49-99 art. 15). The check is recorded offline; its photo goes up once
// the check is on the server and the phone is online.
function Rodents({ farmId, records, houses, day, save, db }: Omit<LogProps, "batches" | "batchLabel"> & { houses: HouseDto[]; db: Parameters<Screen>[0]["db"] }) {
  const t = useTranslations();
  const [error, setError] = useState<string>();
  const online = useOnline();
  const queued = useLiveQuery(() => db.outbox.toArray(), [db]);
  const checks = usePaged(
    of<RodentCheckDto>(records, "rodentCheck")
      .filter((r) => r.farmId === farmId)
      .sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id)),
    "/disposal",
    { tab: "rodents" },
  );
  const unsent = new Set((queued ?? []).flatMap((e) => e.recordKeys ?? []));

  return (
    <Columns
      form={
        <RodentForm
          farmId={farmId}
          houses={houses}
          onSave={(r) => save({ type: B.recordRodentCheck, payload: { ...r, proofFileId: undefined } }, "rodentCheck", r)} // the photo comes online, later
        />
      }
      history={
        <LogSection title={t("Disposal.recentRodents")}>
          {error && <p role="alert" className={danger}>{t(error)}</p>}
          {checks.rows.length === 0 ? (
            <p className={empty}>{t("Disposal.noRodents")}</p>
          ) : (
            <ul className={logList} aria-label={t("Disposal.recentRodents")}>
              {checks.rows.map((r) => (
                <Editable
                  key={r.id}
                  name={day(r.day)}
                  form={(close) => <RodentForm farmId={farmId} houses={houses} check={r} onCancel={close} onSave={async (n) => (await correct(save, B.editRodentCheck, "rodentCheck", r, n)) && (close(), true)} />}
                >
                  <span className="flex flex-col gap-1">
                    <span>
                      {t("Disposal.rodentLine", { date: day(r.day), action: t(`Disposal.rodentActions.${r.action}`) })}
                      {r.product && ` · ${r.product}`}
                      {r.houseId && ` · ${houses.find((h) => h.id === r.houseId)?.name ?? ""}`}
                    </span>
                    {r.proofFileId ? (
                      <a href={`/api/files/${r.proofFileId}`} className="underline underline-offset-4 lg:w-fit">{t("Disposal.proof")}</a>
                    ) : unsent.has(`rodentCheck:${r.id}`) || !online ? (
                      <span className="text-sm text-brick-fg">{t("Disposal.proofMissing")}</span>
                    ) : (
                      <FileUpload url={`/api/files?purpose=proof&rodentCheck=${r.id}`} accept="image/jpeg,image/png,image/webp" camera label={t("Disposal.proofAdd")} look={secondarySm} onError={setError} />
                    )}
                  </span>
                </Editable>
              ))}
            </ul>
          )}
          {checks.pager}
        </LogSection>
      }
    />
  );
}

/** BS8: records a rodent check, or corrects `check` (its photo stays: a proof is never replaced). */
function RodentForm({ farmId, houses, check, onSave, onCancel }: FormProps<RodentCheckDto> & { houses: HouseDto[]; check?: RodentCheckDto }) {
  const t = useTranslations();
  const [key, setKey] = useState(0);
  const [error, setError] = useState<string>(); // in the form: a correction's error shows in its sheet
  const today = farmDayOf(new Date());

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    if (get("day") > today) return setError("errors.DAY_IN_FUTURE");
    setError(undefined);
    const r: RodentCheckDto = {
      id: check?.id ?? uuidv7(),
      farmId,
      houseId: get("house") || null,
      day: get("day") || today,
      action: get("action") as RodentCheckDto["action"],
      product: get("product") || null,
      proofFileId: check?.proofFileId ?? null,
    };
    if ((await onSave(r)) && !check) setKey((k) => k + 1);
  };

  return (
    <form key={key} onSubmit={submit} className={check ? "flex flex-col gap-3" : `${card} gap-3`}>
      <Field label={t("Disposal.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={check?.day ?? today} max={today} required autoFocus={!!check} className={field} />}</Field>
      <Field label={t("Disposal.house")}>
        {(id) => (
          <select id={id} name="house" defaultValue={check ? (check.houseId ?? "") : undefined} className={field}>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            <option value="">{t("Disposal.noHouse")}</option>
          </select>
        )}
      </Field>
      <Field label={t("Disposal.rodentAction")}>
        {(id) => (
          <select id={id} name="action" defaultValue={check?.action} className={field}>
            {RODENT_ACTIONS.map((k) => <option key={k} value={k}>{t(`Disposal.rodentActions.${k}`)}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("Disposal.product")}>{(id) => <input id={id} name="product" maxLength={120} defaultValue={check?.product ?? ""} className={field} />}</Field>
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <Submit label={t("Disposal.saveRodent")} onCancel={onCancel} />
    </form>
  );
}
