import { describe, expect, it } from "vitest";
import { stripDays } from "@/components/batch-strip";
import type { FarmDay } from "@/lib/kernel/farm-day";

// tasks/plan-ui.md U3: the 42-day strip of Today.dc.html (day 23, day 15 missing, vaccines on days 24 and 35).
const d = (s: string) => s as FarmDay;

describe("stripDays", () => {
  const placedOn = d("2026-10-05");
  const entered = new Set(Array.from({ length: 22 }, (_, i) => `2026-10-${String(6 + i).padStart(2, "0")}`).filter((x) => x !== "2026-10-20"));
  const days = stripDays({ placedOn, today: d("2026-10-28"), age: 23, entered, vaccineDays: ["2026-10-29", "2026-11-09"], withdrawal: null });

  it("has 42 days: entered, missing, today and upcoming", () => {
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual({ age: 1, day: "2026-10-06", state: "done", vaccine: false, withdrawal: false });
    expect(days.filter((x) => x.state === "missing").map((x) => [x.age, x.day])).toEqual([[15, "2026-10-20"]]);
    expect(days[22]).toMatchObject({ age: 23, day: "2026-10-28", state: "today" });
    expect(days.slice(23).every((x) => x.state === "upcoming")).toBe(true);
    expect(days.filter((x) => x.vaccine).map((x) => x.age)).toEqual([24, 35]);
  });

  it("grows past 42 days and marks the withdrawal period", () => {
    const late = stripDays({ placedOn, today: d("2026-11-21"), age: 47, entered, vaccineDays: [], withdrawal: { from: d("2026-11-20"), to: d("2026-11-25") } });
    expect(late).toHaveLength(47);
    expect(late.filter((x) => x.withdrawal).map((x) => x.age)).toEqual([46, 47]);
  });

  it("shows a rolling window for the long cycles (SPEC-m3): the last 35 days and the coming 7", () => {
    const layers = stripDays({ placedOn, today: d("2027-01-05"), age: 92, entered, vaccineDays: [], withdrawal: null, rolling: true });
    expect(layers).toHaveLength(42);
    expect([layers[0].age, layers[34].age, layers[41].age]).toEqual([58, 92, 99]);
    expect(layers[34].state).toBe("today");
    const young = stripDays({ placedOn, today: d("2026-10-15"), age: 10, entered, vaccineDays: [], withdrawal: null, rolling: true });
    expect([young[0].age, young.length]).toEqual([1, 42]);
  });
});
