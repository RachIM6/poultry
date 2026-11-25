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

export function BatchStrip({ days, onDark = false, label }: { days: StripDay[]; onDark?: boolean; label: string }) {
  return (
    <div role="img" aria-label={label} className={`flex items-end gap-0.5 ${onDark ? "h-11" : "h-[30px]"}`}>
      {days.map((d) => {
        let bar = BAR[d.state][onDark ? 0 : 1];
        if (d.withdrawal) bar = `${bar.split(" ")[0]} ${d.state === "upcoming" ? "bg-alert-soft" : "bg-alert"}`;
        return <div key={d.age} className={`flex-1 rounded-[2px] ${bar} ${d.vaccine ? "shadow-[inset_0_0_0_2px_var(--color-chick)]" : ""}`} />;
      })}
    </div>
  );
}
