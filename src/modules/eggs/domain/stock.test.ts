import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { checkDiscard, checkGrading, eggLots, stockByAge, stockByItem } from "./stock";

const c = (day: string, normal: number, cracked = 0, broken = 0) => ({ batchId: "b", day, counts: { normal, cracked, dirty: 0, doubleYolk: 2, floor: 0, broken } });
// A hand-made ledger: two laying days, one graded, a few discarded.
const flows = {
  collections: [c("2026-11-10", 1000, 10, 3), c("2026-11-10", 500), c("2026-11-14", 800, 5)],
  gradings: [{ batchId: "b", laidOn: "2026-11-10", grades: { m: 900, l: 500 } }],
  discards: [{ batchId: "b", laidOn: "2026-11-10", item: "downgraded" as const, eggs: 4 }],
};

describe("egg stock (SPEC-m3 E2–E4)", () => {
  const lots = eggLots(flows);

  it("adds collections, moves graded eggs, takes discards; broken eggs never enter", () => {
    expect(lots).toEqual([
      { batchId: "b", laidOn: "2026-11-10", item: "ungraded", eggs: 104 }, // 1 002 + 502 − 1 400 graded
      { batchId: "b", laidOn: "2026-11-10", item: "downgraded", eggs: 6 }, // 10 − 4 discarded
      { batchId: "b", laidOn: "2026-11-10", item: "grade:l", eggs: 500 },
      { batchId: "b", laidOn: "2026-11-10", item: "grade:m", eggs: 900 },
      { batchId: "b", laidOn: "2026-11-14", item: "ungraded", eggs: 802 },
      { batchId: "b", laidOn: "2026-11-14", item: "downgraded", eggs: 5 },
    ]);
    expect(stockByItem(lots)).toEqual({ ungraded: 906, downgraded: 11, "grade:l": 500, "grade:m": 900 });
  });

  it("buckets eggs by days since laying", () => {
    expect(stockByAge(lots, "2026-11-16" as FarmDay)).toEqual({ "0-2": 807, "3-5": 0, "6+": 1510 });
    expect(stockByAge(lots, "2026-11-15" as FarmDay)).toEqual({ "0-2": 807, "3-5": 1510, "6+": 0 });
  });

  it("grades or discards no more than the lot holds", () => {
    expect(checkGrading(lots, { batchId: "b", laidOn: "2026-11-10", grades: { s: 104 } }).ok).toBe(true);
    expect(checkGrading(lots, { batchId: "b", laidOn: "2026-11-10", grades: { s: 100, m: 5 } })).toEqual({ ok: false, error: "NOT_ENOUGH_EGGS" });
    expect(checkGrading(lots, { batchId: "b", laidOn: "2026-11-10", grades: { s: 0 } })).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    expect(checkGrading(lots, { batchId: "b", laidOn: "2026-11-11", grades: { s: 1 } })).toEqual({ ok: false, error: "NOT_ENOUGH_EGGS" });
    expect(checkDiscard(lots, { batchId: "b", laidOn: "2026-11-10", item: "grade:m", eggs: 900 }).ok).toBe(true);
    expect(checkDiscard(lots, { batchId: "b", laidOn: "2026-11-10", item: "grade:m", eggs: 901 })).toEqual({ ok: false, error: "NOT_ENOUGH_EGGS" });
    expect(checkDiscard(lots, { batchId: "b", laidOn: "2026-11-10", item: "grade:m", eggs: 0 })).toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });
});
