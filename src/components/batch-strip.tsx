import { addFarmDays, type FarmDay } from "@/lib/kernel/farm-day";

// The design's signature (Today.dc.html, WebOverview.dc.html): one bar per day of the batch. Done days stay neutral;
// colour only for what needs action: a missing day, today, a vaccine due, the withdrawal period.

export type StripDay = { age: number; day: FarmDay; state: "done" | "missing" | "today" | "upcoming"; vaccine: boolean; withdrawal: boolean };

/** Days 1 … max(42, age) of a batch placed on `placedOn`, seen on `today`. Pure. */
export function stripDays(input: {
  placedOn: FarmDay;
  today: FarmDay;
  age: number;
  entered: ReadonlySet<string>; // farm days with a daily entry
  vaccineDays: readonly string[]; // due days of vaccinations not done yet
  withdrawal: { from: FarmDay; to: FarmDay } | null;
}): StripDay[] {
  const length = Math.max(42, input.age);
  return Array.from({ length }, (_, i) => {
    const age = i + 1;
    const day = addFarmDays(input.placedOn, age);
    const state = age === input.age ? "today" : age > input.age ? "upcoming" : input.entered.has(day) ? "done" : "missing";
    const withdrawal = input.withdrawal !== null && day >= input.withdrawal.from && day <= input.withdrawal.to;
    return { age, day, state, vaccine: input.vaccineDays.includes(day), withdrawal };
  });
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
