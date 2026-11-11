import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { checkDone, planVaccinations, remindedDueOn, statusOn } from "@/modules/health/domain/vaccination";

const day = (d: string) => d as FarmDay;

// A made-up protocol, to test the dates only: NOT a vaccination schedule (the default one waits for a vet, OQ4).
const FIXTURE = [
  { dayOfAge: 14, productId: "vaccine-gumboro", method: "drinkingWater" },
  { dayOfAge: 0, productId: "vaccine-newcastle", method: "spray" },
  { dayOfAge: 7, productId: "vaccine-infectious-bronchitis", method: "eyeDrop" },
  { dayOfAge: 0, productId: "vaccine-infectious-bronchitis", method: "spray" },
];

describe("vaccination plan (SPEC H1)", () => {
  it("gives each protocol line its due day from the placement day (day 0), in order of age", () => {
    expect(planVaccinations(day("2026-10-25"), FIXTURE)).toEqual([
      { dayOfAge: 0, productId: "vaccine-newcastle", method: "spray", dueOn: "2026-10-25" },
      { dayOfAge: 0, productId: "vaccine-infectious-bronchitis", method: "spray", dueOn: "2026-10-25" }, // same day: protocol order
      { dayOfAge: 7, productId: "vaccine-infectious-bronchitis", method: "eyeDrop", dueOn: "2026-11-01" }, // across the month
      { dayOfAge: 14, productId: "vaccine-gumboro", method: "drinkingWater", dueOn: "2026-11-08" },
    ]);
    expect(FIXTURE[0].dayOfAge).toBe(14); // the protocol itself is left as it was
  });

  it("counts calendar days across a year end and a leap day", () => {
    expect(planVaccinations(day("2027-12-25"), [{ dayOfAge: 10, productId: "v", method: "spray" }])[0].dueOn).toBe("2028-01-04");
    expect(planVaccinations(day("2028-02-20"), [{ dayOfAge: 10, productId: "v", method: "spray" }])[0].dueOn).toBe("2028-03-01");
  });

  it("is empty for an empty protocol", () => {
    expect(planVaccinations(day("2026-10-25"), [])).toEqual([]);
  });
});

describe("marking a vaccination done (SPEC H2)", () => {
  const open = { placedOn: day("2026-10-25"), status: "open" as const };
  const today = day("2026-11-07");

  it("accepts a day between placement and today, with a positive number of doses", () => {
    expect(checkDone({ done: null }, open, day("2026-10-25"), 1000, today)).toEqual({ ok: true, value: undefined });
    expect(checkDone({ done: null }, open, today, 1, today).ok).toBe(true);
  });

  it("refuses a second time, a closed batch, a day outside the batch and no doses", () => {
    const err = (r: ReturnType<typeof checkDone>) => (r.ok ? "ok" : r.error);
    expect(err(checkDone({ done: { on: "2026-11-01" } }, open, today, 1000, today))).toBe("ALREADY_DONE");
    expect(err(checkDone({ done: null }, { ...open, status: "closed" }, today, 1000, today))).toBe("BATCH_CLOSED");
    expect(err(checkDone({ done: null }, open, day("2026-10-24"), 1000, today))).toBe("DAY_BEFORE_PLACEMENT");
    expect(err(checkDone({ done: null }, open, day("2026-11-08"), 1000, today))).toBe("DAY_IN_FUTURE");
    expect(err(checkDone({ done: null }, open, today, 0, today))).toBe("INVALID_QUANTITY");
    expect(err(checkDone({ done: null }, open, today, 2.5, today))).toBe("INVALID_QUANTITY");
  });
});

describe("status and reminders (SPEC H2)", () => {
  const today = day("2026-11-07");

  it("tells done, late, today and upcoming apart", () => {
    expect(statusOn({ dueOn: day("2026-11-01"), done: { on: "2026-11-01" } }, today)).toBe("done");
    expect(statusOn({ dueOn: day("2026-11-06"), done: null }, today)).toBe("late");
    expect(statusOn({ dueOn: today, done: null }, today)).toBe("today");
    expect(statusOn({ dueOn: day("2026-11-08"), done: null }, today)).toBe("upcoming");
  });

  it("reminds the day before the due day and on the due day", () => {
    expect(remindedDueOn(today)).toEqual({ dayBefore: "2026-11-08", dueDay: "2026-11-07" });
    expect(remindedDueOn(day("2026-12-31")).dayBefore).toBe("2027-01-01");
  });
});
