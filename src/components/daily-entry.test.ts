import { describe, expect, it } from "vitest";
import { lastFeed } from "@/components/daily-entry";
import type { DailyEntryDto } from "@/modules/flock/shared";

// The demo rehearsal: day 24 of a batch on grower opened on the starter, and 850 kg came out of the starter's 258 kg.
const entry = (day: string, stockItemId: string | null): DailyEntryDto =>
  ({ id: day, batchId: "b", day, dead: 0, deathCause: null, culled: 0, feed: stockItemId ? { stockItemId, grams: 1000 } : null, waterMl: null, note: null }) as DailyEntryDto;

describe("lastFeed", () => {
  const entries = [entry("2026-11-10", "starter"), entry("2026-11-20", "grower"), entry("2026-11-21", null), entry("2026-11-24", "finisher")];

  it("is the feed of the latest earlier day that had one", () => {
    expect(lastFeed(entries, "2026-11-22")).toBe("grower");
    expect(lastFeed(entries, "2026-11-25")).toBe("finisher");
  });

  it("is none before the first day with feed", () => {
    expect(lastFeed(entries, "2026-11-10")).toBeUndefined();
    expect(lastFeed([], "2026-11-10")).toBeUndefined();
  });
});
