import { useTranslations } from "next-intl";
import { addFarmDays, type FarmDay } from "@/lib/kernel/farm-day";
import { ageOn } from "@/modules/flock/shared";

// The design's signature (Today.dc.html, WebOverview.dc.html): one bar per day of the batch. Done days stay neutral;
// colour only for what needs action: a missing day, today, a vaccine due, the withdrawal period.

export type StripDay = { age: number; day: FarmDay; state: "done" | "missing" | "today" | "upcoming"; vaccine: boolean; withdrawal: boolean };

/**
 * Days 1 … max(42, age) of a batch placed on `placedOn`, seen on `today`. Pure. A long cycle (SPEC-m3: pullets, layers,
 * turkeys, beldi) shows a rolling window instead: the last 35 days and the coming 7, so the bars stay readable.
 */
export function stripDays(input: {
  placedOn: FarmDay;
  today: FarmDay;
  age: number;
  entered: ReadonlySet<string>; // farm days with a daily entry
  vaccineDays: readonly string[]; // due days of vaccinations not done yet
  withdrawal: { from: FarmDay; to: FarmDay } | null;
  rolling?: boolean;
}): StripDay[] {
  const start = input.rolling ? Math.max(1, input.age - 34) : 1;
  const length = input.rolling ? 42 : Math.max(42, input.age);
  return Array.from({ length }, (_, i) => {
    const age = start + i;
    const day = addFarmDays(input.placedOn, age);
    const state = age === input.age ? "today" : age > input.age ? "upcoming" : input.entered.has(day) ? "done" : "missing";
    const withdrawal = input.withdrawal !== null && day >= input.withdrawal.from && day <= input.withdrawal.to;
    return { age, day, state, vaccine: input.vaccineDays.includes(day), withdrawal };
  });
}

/** A /batches card's strip (tasks/plan-ui.md U4), from the batch's own rows. */
export function batchStrip(
  b: { placedOn: string; species: string },
  today: FarmDay,
  own: { entries: readonly { day: string }[]; vaccinations: readonly { done: unknown; dueOn: string }[]; treatments: readonly { startOn: string; withdrawalEndsOn: string }[] },
) {
  // H4's rule (health's withdrawalUntil) read from each treatment's withdrawalEndsOn, which the same rule computed when
  // it was recorded: importing health here would push the page over its 200 KB budget (SPEC §9.3).
  const running = own.treatments.filter((x) => x.startOn <= today && today <= x.withdrawalEndsOn).map((x) => x.withdrawalEndsOn).sort();
  const until = (running.at(-1) ?? null) as FarmDay | null;
  const from = own.treatments.filter((x) => x.withdrawalEndsOn >= today).map((x) => x.startOn).sort()[0];
  const age = ageOn(b.placedOn as FarmDay, today);
  const days = stripDays({
    placedOn: b.placedOn as FarmDay,
    today,
    age,
    entered: new Set(own.entries.map((e) => e.day)),
    vaccineDays: own.vaccinations.filter((v) => !v.done).map((v) => v.dueOn),
    withdrawal: until && from ? { from: from as FarmDay, to: until } : null,
    rolling: b.species !== "broiler", // SPEC-m3: long cycles show a rolling window
  });
  return { age, days };
}

// On the dark header (`onDark`) done days are Sable, on a white card they are the darker "saisi".
const BAR: Record<StripDay["state"], [string, string]> = {
  done: ["h-7 bg-sand", "h-5 bg-entered"],
  missing: ["h-7 bg-brick", "h-5 bg-brick"],
  today: ["h-11 bg-chick", "h-[30px] bg-chick"],
  upcoming: ["h-4 bg-shell/15", "h-3 bg-line"],
};

// UX review A6: the withdrawal period is a thin line under its days, not a red fill (too close to "missing"), so
// today stays yellow. The vaccine ring and the line are box-shadows (whole class names, for Tailwind to find them);
// the strip keeps room under it for the line. WCAG 1.4.11 (3:1 for a graphic that carries meaning) against the ground
// it sits on: on the ink strips, alert #b3261e is only 2.45:1, so a lighter alert tint #ef5350 (4.60:1 on ink #24211c),
// red rather than the orange « Manquant » brick #c4541d; on the white cards, alert #b3261e (6.54:1 on #ffffff).
const SHADOW = {
  dark: {
    vv: "shadow-[inset_0_0_0_2px_var(--color-chick),0_4px_0_-1px_#ef5350]",
    v: "shadow-[inset_0_0_0_2px_var(--color-chick)]",
    w: "shadow-[0_4px_0_-1px_#ef5350]",
  },
  light: {
    vv: "shadow-[inset_0_0_0_2px_var(--color-chick),0_4px_0_-1px_var(--color-alert)]",
    v: "shadow-[inset_0_0_0_2px_var(--color-chick)]",
    w: "shadow-[0_4px_0_-1px_var(--color-alert)]",
  },
};

export function BatchStrip({ days, onDark = false, label }: { days: StripDay[]; onDark?: boolean; label: string }) {
  const line = days.some((d) => d.withdrawal);
  const shadows = SHADOW[onDark ? "dark" : "light"];
  return (
    <div role="img" aria-label={label} className={`flex items-end gap-0.5 ${onDark ? "h-11" : "h-[30px]"} ${line ? "mb-1" : ""}`}>
      {days.map((d) => {
        const shadow = d.vaccine && d.withdrawal ? shadows.vv : d.vaccine ? shadows.v : d.withdrawal ? shadows.w : "";
        return <div key={d.age} className={`flex-1 rounded-[2px] ${BAR[d.state][onDark ? 0 : 1]} ${shadow}`} />;
      })}
    </div>
  );
}

// The landing's legend swatches (landing.tsx), on the same dark ground, plus the withdrawal line.
const LEGEND = {
  done: "size-3.5 rounded-[3px] bg-sand",
  missing: "size-3.5 rounded-[3px] bg-brick",
  today: "size-3.5 rounded-[3px] bg-chick",
  vaccine: "size-3.5 rounded-[3px] bg-shell/15 shadow-[inset_0_0_0_2px_var(--color-chick)]",
  withdrawal: "h-1 w-3.5 rounded-full bg-[#ef5350]", // the dark strips' line (SHADOW.dark): 4.60:1 on ink
  upcoming: "size-3.5 rounded-[3px] bg-shell/15",
} as const;

/** Under a dark strip: what its colours mean, only those it shows (one legend for several strips: all their days). */
export function StripLegend({ days }: { days: StripDay[] }) {
  const t = useTranslations("Strip");
  const shown = (k: keyof typeof LEGEND) => days.some((d) => (k === "vaccine" ? d.vaccine : k === "withdrawal" ? d.withdrawal : d.state === k));
  return (
    <ul aria-label={t("legendLabel")} className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-sand">
      {(Object.keys(LEGEND) as (keyof typeof LEGEND)[]).filter(shown).map((k) => (
        <li key={k} className="flex items-center gap-2">
          <span aria-hidden="true" className={LEGEND[k]} />
          {t(`legend.${k}`)}
        </li>
      ))}
    </ul>
  );
}
