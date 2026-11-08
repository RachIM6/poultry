import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { checkBatchDay, checkTreatment, withdrawalEnd, withdrawalUntil } from "@/modules/health/domain/withdrawal";

const day = (d: string) => d as FarmDay;
// Made-up withdrawal days, to test the dates only: the real ones come from each medicine's label (OQ4).
const t = (endOn: string, withdrawalDays: number, startOn = "2026-11-01") => ({ startOn: day(startOn), endOn: day(endOn), withdrawalDays });

describe("withdrawal end (SPEC H3)", () => {
  it("is the treatment's end day + the product's withdrawal days, in farm days", () => {
    expect(withdrawalEnd(t("2026-11-08", 5))).toBe("2026-11-13");
    expect(withdrawalEnd(t("2026-12-29", 7))).toBe("2027-01-05"); // across the year
    expect(withdrawalEnd(t("2028-02-27", 2))).toBe("2028-02-29"); // leap day
    expect(withdrawalEnd(t("2026-11-08", 0))).toBe("2026-11-08"); // no withdrawal: the treatment's own end
  });
});

describe("withdrawal running on a day (SPEC H4)", () => {
  it("runs through its end day, then stops", () => {
    const treatments = [t("2026-11-08", 5)];
    expect(withdrawalUntil(treatments, day("2026-11-03"))).toBe("2026-11-13"); // during the treatment
    expect(withdrawalUntil(treatments, day("2026-11-13"))).toBe("2026-11-13"); // the last day
    expect(withdrawalUntil(treatments, day("2026-11-14"))).toBeNull();
  });

  it("takes the latest end among overlapping treatments, whatever their order", () => {
    const short = t("2026-11-10", 3); // ends 11-13
    const long = t("2026-11-06", 10); // ends earlier, withdraws longer: 11-16
    expect(withdrawalUntil([short, long], day("2026-11-08"))).toBe("2026-11-16");
    expect(withdrawalUntil([long, short], day("2026-11-08"))).toBe("2026-11-16");
    expect(withdrawalUntil([short, long], day("2026-11-16"))).toBe("2026-11-16");
    expect(withdrawalUntil([short, long], day("2026-11-17"))).toBeNull();
  });

  it("starts on the treatment's start day: a sale made before it is not blocked", () => {
    const treatments = [t("2026-11-08", 5, "2026-11-04")];
    expect(withdrawalUntil(treatments, day("2026-11-03"))).toBeNull();
    expect(withdrawalUntil(treatments, day("2026-11-04"))).toBe("2026-11-13");
  });

  it("is null without treatments", () => {
    expect(withdrawalUntil([], day("2026-11-08"))).toBeNull();
  });
});

describe("recording a treatment or a vet visit (SPEC H3, H5)", () => {
  const batch = { placedOn: day("2026-11-01"), status: "open" as const };
  const today = day("2026-11-08");

  it("happens to an open batch, between its placement and today", () => {
    expect(checkBatchDay(batch, day("2026-11-01"), today).ok).toBe(true);
    expect(checkBatchDay(batch, today, today).ok).toBe(true);
    expect(checkBatchDay(batch, day("2026-10-31"), today)).toEqual({ ok: false, error: "DAY_BEFORE_PLACEMENT" });
    expect(checkBatchDay(batch, day("2026-11-09"), today)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(checkBatchDay({ ...batch, status: "closed" }, today, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
  });

  it("may still be running, but ends on or after its start, with some medicine", () => {
    const tr = { startOn: day("2026-11-06"), endOn: day("2026-11-10"), quantity: 500 };
    expect(checkTreatment(batch, tr, today).ok).toBe(true); // ends in two days
    expect(checkTreatment(batch, { ...tr, endOn: tr.startOn }, today).ok).toBe(true); // one day
    expect(checkTreatment(batch, { ...tr, startOn: day("2026-11-09") }, today)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(checkTreatment(batch, { ...tr, endOn: day("2026-11-05") }, today)).toEqual({ ok: false, error: "END_BEFORE_START" });
    expect(checkTreatment(batch, { ...tr, quantity: 0 }, today)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkTreatment({ ...batch, status: "closed" }, tr, today)).toEqual({ ok: false, error: "BATCH_CLOSED" });
  });
});
