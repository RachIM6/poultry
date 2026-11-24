import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { batchKpis, closedBatchFigures } from "./kpi";
import { shownFcrEpef } from "./shown-fcr";

// 1 000 started on 1 Sep, 30 out, 4 200 kg of feed; weighed on day 35 at 2 000 g; 970 sold on day 42 for 2 425 kg.
const b = { placedOn: "2026-09-01", birdsStarted: 1000, dayOldWeightGrams: null, closedOn: "2026-10-13" };
const entries = [
  { day: "2026-09-05", dead: 10, culled: 0, feed: { grams: 1_200_000 } },
  { day: "2026-09-20", dead: 20, culled: 0, feed: { grams: 3_000_000 } },
];
const weighed = batchKpis({ ...b, placedOn: b.placedOn as FarmDay }, entries, [{ id: "w", day: "2026-10-06", count: 50, totalGrams: 100_000 }], b.closedOn as FarmDay).weighed;
const sold = [{ day: "2026-10-13", birds: 970, liveWeightGrams: 2_425_000 }];

describe("the FCR and EPEF a batch's screens show", () => {
  it("a closed batch: its final figures, feed ÷ kg sold at closing, never the last weighing's estimate", () => {
    const f = closedBatchFigures(b, entries, sold);
    expect(shownFcrEpef({ ...b, status: "closed" }, weighed, entries, sold)).toEqual({ fcr: f.fcr, epef: f.epef });
    expect(f.fcr).toBeCloseTo(4200 / 2425, 9);
    expect(weighed?.fcr).not.toBeCloseTo(f.fcr!, 2); // the estimate differs: the point of the rule
  });

  it("an open batch: the estimate at its latest weighing, none before it", () => {
    const open = { ...b, status: "open", closedOn: undefined };
    expect(shownFcrEpef(open, weighed, entries, sold)).toEqual({ fcr: weighed!.fcr, epef: weighed!.epef });
    expect(shownFcrEpef(open, null, entries, sold)).toEqual({ fcr: null, epef: null });
  });

  it("a closed batch with nothing sold has no FCR nor EPEF (0 would read as perfect)", () => {
    expect(shownFcrEpef({ ...b, status: "closed" }, weighed, entries, [])).toEqual({ fcr: null, epef: null });
  });
});
