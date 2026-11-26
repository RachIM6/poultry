import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { BatchStrip, type StripDay } from "@/components/batch-strip";
import { homeKpis, homeTasks, type HomeBatch, type HomeVaccine } from "@/components/today-cockpit";
import { Link } from "@/i18n/navigation";
import { formatCount } from "@/lib/format";

// The wide home « A · Cockpit » (tasks/plan-ui.md U18, Main.dc.html): from lg only, beside the phone's home that
// today.tsx keeps as it was (`lg:hidden` there, `hidden lg:…` here). CSS only: no hook decides the width.

/** One batch as the wide home shows it: today.tsx's figures, already worded. */
export type CockpitRow = Omit<HomeBatch, "vaccines"> & {
  vaccines: readonly (HomeVaccine & { name: string; detail: ReactNode })[];
  strain: string;
  age: string; // « Jour 24 sur 42 », « 10 sem. »
  days: StripDay[];
  stripLabel: string;
  missingText: string | null; // « Jour manquant : 17 nov. »
  withdrawalText: string | null; // the row's « Délai d’attente jusqu’au … inclus »
  withdrawalAlert: string | null; // the checklist's banner, as on the phone
  missingTask: { title: string; hint: string } | null; // the checklist's row for the missing days
  kpi: ReactNode; // the inline figures under the bird count
};

const panel = "rounded-[18px] border border-line bg-card";

/** A tile of the top row; a server component too (the cash tile, dashboard/page.tsx). */
export function Figure({ label, value, note, href, busy, attention }: { label: string; value?: ReactNode; note?: ReactNode; href?: string; busy?: boolean; attention?: boolean }) {
  const body = (
    <>
      <span className={`text-sm ${attention ? "text-chick-fg" : "text-ink-2"}`}>{label}</span>
      <b className="min-h-[34px] whitespace-nowrap text-[28px] font-semibold leading-tight">{value}</b>
      {note && <span className="text-[13px] text-muted">{note}</span>}
    </>
  );
  const box = `flex flex-col gap-1 rounded-[18px] border px-[18px] py-4 ${attention ? "border-chick-edge bg-chick-soft" : "border-line bg-card"}`;
  if (!href) return <div aria-busy={busy} className={box}>{body}</div>;
  // A hash stays on the page; a path goes through the locale-aware Link.
  return href.startsWith("#") ? <a href={href} className={box}>{body}</a> : <Link href={href} className={box}>{body}</Link>;
}

/** The top row: yesterday's eggs, the live birds, the cash (streamed in by the server), the tasks left. */
export function CockpitFigures({ kpis, cash }: { kpis: ReturnType<typeof homeKpis>; cash: ReactNode }) {
  const t = useTranslations("Today");
  if (!kpis.eggs && !kpis.birds && !cash && !kpis.tasks) return null;
  const { tasks } = kpis;
  return (
    <section aria-label={t("figures")} className="hidden lg:col-span-full lg:grid lg:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] lg:gap-3.5">
      {kpis.eggs && <Figure label={t("eggsYesterday")} value={formatCount(kpis.eggs.total)} note={<bdi>{kpis.eggs.houses.join(" · ")}</bdi>} />}
      {kpis.birds && (
        <Figure
          label={t("liveBirds")}
          value={formatCount(kpis.birds.total)}
          note={t("openBatches", { count: kpis.birds.batches, n: formatCount(kpis.birds.batches) })}
        />
      )}
      {cash}
      {tasks && (
        <Figure
          href="#taches"
          attention={tasks.remaining > 0}
          label={t("tasksLeft")}
          value={formatCount(tasks.remaining)}
          note={
            tasks.missing > 0 ? (
              <span className="font-semibold text-brick-fg">{t("tasksMissing", { count: tasks.missing, n: formatCount(tasks.missing) })}</span>
            ) : tasks.remaining === 0 ? (
              t("tasksAllDone")
            ) : null
          }
        />
      )}
    </section>
  );
}

// The light strips' legend (batch-strip.tsx's StripLegend is for the dark header, and that file is in /batches' first
// load): only the states the strips show (UX review A6).
const LEGEND = {
  done: "size-3.5 rounded-[3px] bg-entered",
  missing: "size-3.5 rounded-[3px] bg-brick",
  today: "size-3.5 rounded-[3px] bg-chick",
  vaccine: "size-3.5 rounded-[3px] bg-line shadow-[inset_0_0_0_2px_var(--color-chick)]",
  withdrawal: "h-1 w-3.5 rounded-full bg-alert",
  upcoming: "size-3.5 rounded-[3px] bg-line",
} as const;

/** The left column: one row per open batch, its strip and its figures inline. */
export function CockpitBatches({ rows, farming }: { rows: readonly CockpitRow[]; farming: boolean }) {
  const t = useTranslations();
  if (rows.length === 0) return null;
  const days = rows.flatMap((r) => r.days);
  const shown = (k: keyof typeof LEGEND) => days.some((d) => (k === "vaccine" ? d.vaccine : k === "withdrawal" ? d.withdrawal : d.state === k));
  return (
    <section aria-labelledby="home-batches" className={`hidden px-5 pb-4 pt-1.5 lg:block ${panel}`}>
      <div className="flex min-h-[52px] items-center justify-between gap-3">
        <h2 id="home-batches" className="text-[17px] font-semibold">{t("Today.batchesOpen")}</h2>
        <Link href="/batches" className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">{t("Today.allBatches")}</Link>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="border-t border-line">
            <Link href={{ pathname: "/batches", hash: r.id }} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 py-3.5">
              <span className="flex flex-[1_1_150px] flex-col gap-0.5">
                <b className="font-semibold"><bdi>{r.house}</bdi></b>
                <span className="text-[13px] text-ink-2"><bdi>{r.strain}</bdi> · {r.age}</span>
              </span>
              {farming && (
                <span className="flex flex-[999_1_260px] flex-col gap-2">
                  <BatchStrip days={r.days} label={r.stripLabel} />
                  <span className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px]">
                    {r.missingText ? <span className="font-semibold text-brick-fg">{r.missingText}</span> : <span className="text-muted">{t("Today.allEntered")}</span>}
                    {r.withdrawalText && <span className="font-semibold text-alert-fg">{r.withdrawalText}</span>}
                  </span>
                </span>
              )}
              <span className="flex flex-[1_1_130px] flex-col items-end gap-0.5 text-end">
                {farming && <b className="text-[15px] font-semibold">{t("Today.birds", { count: formatCount(r.birds) })}</b>}
                {r.kpi && <span className="text-[13px] text-ink-2">{r.kpi}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {farming && (
        <ul aria-label={t("Strip.legendLabel")} className="flex flex-wrap gap-x-[18px] gap-y-1.5 border-t border-line px-1 pt-3.5 text-[13px] text-ink-2">
          {(Object.keys(LEGEND) as (keyof typeof LEGEND)[]).filter(shown).map((k) => (
            <li key={k} className="flex items-center gap-2">
              <span aria-hidden="true" className={LEGEND[k]} />
              {t(`Strip.legend.${k}`)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ICON = {
  missing: "M12 8v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  vaccine: "M17 3l4 4M19 5l-9.5 9.5M14 6l4 4M5 15l4 4M7 13l-4.5 4.5 4 4L11 17",
};
const Svg = ({ d, size = 20, className }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <path d={d} />
  </svg>
);
const urgentRow = "flex min-h-[60px] items-center gap-3 py-2";
const badge = "grid size-9 shrink-0 place-items-center rounded-[10px]";

/** The right rail's checklist: the withdrawals and what is late first, then one « Saisir » per house. */
export function CockpitTasks({ rows, recording, remaining }: { rows: readonly CockpitRow[]; recording: boolean; remaining: number }) {
  const t = useTranslations("Today");
  const { alerts, urgent, entries } = homeTasks(rows, recording);
  return (
    <section id="taches" aria-labelledby="home-tasks" className={`hidden px-4 pb-2.5 pt-1.5 lg:block ${panel}`}>
      <div className="flex min-h-[52px] items-center justify-between gap-3">
        <h2 id="home-tasks" className="text-[17px] font-semibold">{t("tasks")}</h2>
        <span className="text-sm text-muted">{t("toDo", { n: formatCount(remaining) })}</span>
      </div>
      {alerts.map((r) => (
        <p key={r.id} role="status" className="mb-2.5 rounded-[14px] bg-alert-soft px-3.5 py-3 text-sm leading-normal text-alert-fg">
          <b className="font-semibold"><bdi>{r.house}</bdi> : </b>
          {r.withdrawalAlert}
        </p>
      ))}
      {urgent.length > 0 && (
        <ul>
          {urgent.map((x) => (
            <li key={x.kind === "missing" ? `m-${x.batch.id}` : x.vaccine.id}>
              <Link href={{ pathname: "/batches", hash: x.batch.id }} className={urgentRow}>
                <span className={`${badge} ${x.kind === "missing" || x.vaccine.status === "late" ? "bg-brick-soft text-brick-fg" : "bg-chick-soft"}`}>
                  <Svg d={ICON[x.kind]} />
                </span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <b className="text-[15px] font-semibold">{x.kind === "missing" ? x.batch.missingTask?.title : x.vaccine.name}</b>
                  <span className="text-[13px] text-ink-2">{x.kind === "missing" ? x.batch.missingTask?.hint : x.vaccine.detail}</span>
                </span>
                <Svg d="M9 6l6 6-6 6" size={18} className="shrink-0 rtl:-scale-x-100" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {entries.length > 0 && (
        <>
          <p id="home-entries" className={`pb-1 pt-2.5 text-[13px] text-ink-2 ${urgent.length > 0 ? "border-t border-line" : ""}`}>
            {t("entries")} · {t("entryHint")}
          </p>
          <ul aria-labelledby="home-entries">
            {entries.map((r) =>
              r.enteredToday ? (
                <li key={r.id} className="flex min-h-[52px] items-center gap-3 text-olive">
                  <Svg d="M5 12l5 5L20 7" size={18} className="shrink-0" />
                  <span className="flex-1 text-[15px]">{t("entryDone", { house: r.house })}</span>
                </li>
              ) : (
                <li key={r.id} className="flex min-h-[52px] items-center gap-3">
                  <span aria-hidden="true" className="size-[18px] shrink-0 rounded-full border-2 border-muted" />
                  <span className="flex-1 text-[15px]">{t("entry", { house: r.house })}</span>
                  <Link
                    href={{ pathname: "/batches", hash: r.id }}
                    className="inline-flex min-h-11 items-center rounded-xl bg-chick px-3.5 text-sm font-semibold text-ink shadow-[0_2px_0_var(--color-chick-edge)]"
                  >
                    {t("enter")}
                    <span className="sr-only"> · {r.house}</span>
                  </Link>
                </li>
              ),
            )}
          </ul>
        </>
      )}
      {urgent.length === 0 && entries.length === 0 && <p className="pb-2 text-sm text-ink-2">{t("nothingToDo")}</p>}
    </section>
  );
}
