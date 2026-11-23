import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { checkAdd, checkEdit, lineDueOn, moveLine } from "@/modules/health/domain/plan-edit";
import { planVaccinations } from "@/modules/health/domain/vaccination";

const day = (d: string) => d as FarmDay;
const open = { placedOn: day("2026-10-25"), ageAtPlacementDays: 0, status: "open" as const };
const closed = { ...open, status: "closed" as const };
const started = { ...open, ageAtPlacementDays: 7 }; // started pullets (SPEC-m3 B7)
const done = { on: "2026-11-01" };

describe("editing a batch's vaccination plan (SPEC H1, SPEC-m5 PA4)", () => {
  it("dates a line by hand as the plan dates a protocol line", () => {
    for (const batch of [open, started]) {
      for (const dayOfAge of [7, 14, 35]) {
        const [planned] = planVaccinations(batch.placedOn, [{ dayOfAge, productId: "v", method: "spray" }], batch.ageAtPlacementDays);
        expect(lineDueOn(batch, dayOfAge)).toEqual({ ok: true, value: planned.dueOn });
      }
    }
    expect(lineDueOn(open, 0)).toEqual({ ok: true, value: "2026-10-25" }); // day 0 = placement day
    expect(lineDueOn(started, 7)).toEqual({ ok: true, value: "2026-10-25" }); // they arrived 7 days old
  });

  it("refuses a day of age before the birds arrived", () => {
    expect(lineDueOn(started, 6)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
    expect(checkAdd(started, 6)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
  });

  it("adds a line only to an open batch", () => {
    expect(checkAdd(open, 21)).toEqual({ ok: true, value: "2026-11-15" });
    expect(checkAdd(closed, 21)).toEqual({ ok: false, error: "BATCH_CLOSED" });
  });

  it("moves or cancels only a line not yet done, on an open batch", () => {
    expect(checkEdit({ done: null }, open)).toEqual({ ok: true, value: undefined });
    expect(checkEdit({ done }, open)).toEqual({ ok: false, error: "ALREADY_DONE" });
    expect(checkEdit({ done: null }, closed)).toEqual({ ok: false, error: "BATCH_CLOSED" });
  });

  it("moves a line to its new due day, and asks for its reminders again only when the day changed", () => {
    const line = { done: null, dueOn: "2026-11-08" }; // day 14
    expect(moveLine(line, open, 16)).toEqual({ ok: true, value: { dayOfAge: 16, dueOn: "2026-11-10", remindAgain: true } });
    expect(moveLine(line, open, 14)).toEqual({ ok: true, value: { dayOfAge: 14, dueOn: "2026-11-08", remindAgain: false } });
    expect(moveLine({ ...line, done }, open, 16)).toEqual({ ok: false, error: "ALREADY_DONE" });
    expect(moveLine(line, closed, 16)).toEqual({ ok: false, error: "BATCH_CLOSED" });
    expect(moveLine(line, started, 3)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
  });
});
