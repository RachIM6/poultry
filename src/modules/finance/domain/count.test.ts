import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { countDay, countLines, countYearOf, parseCounted, type CountLine } from "@/modules/finance/domain/count";

const day = (d: string) => d as FarmDay;

describe("year-end count (SPEC-finance FC3)", () => {
  it("counts on the fiscal year's last day, by the year it ends in", () => {
    expect(countDay(2026, 1)).toBe("2026-12-31");
    expect(countDay(2026, 7)).toBe("2026-06-30"); // July 2025 – June 2026
    expect(countDay(2028, 3)).toBe("2028-02-29");
    expect(countYearOf(day("2026-11-20"), 1)).toBe(2026);
    expect(countYearOf(day("2026-11-20"), 7)).toBe(2027);
    expect(countYearOf(day("2026-06-30"), 7)).toBe(2026);
  });

  const batch = { farmId: "f", houseId: "h", houseName: "B1", species: "broiler", started: 1000 };
  const out = [
    { day: "2026-12-20", birds: 30 }, // dead
    { day: "2026-12-31", birds: 400 }, // sold on the count day
    { day: "2027-01-02", birds: 570 }, // after it
  ];

  it("lists the batches open at the end of the count day with their birds on hand, and the stock items", () => {
    const lines = countLines(
      day("2026-12-31"),
      [
        { ...batch, id: "open", placedOn: "2026-12-01", closedOn: "2027-01-02", out },
        { ...batch, id: "closed-that-day", placedOn: "2026-11-01", closedOn: "2026-12-31", out: [] },
        { ...batch, id: "placed-after", placedOn: "2027-01-01", closedOn: null, out: [] },
        { ...batch, id: "still-open", placedOn: "2026-12-30", closedOn: null, out: [] },
      ],
      [
        { id: "feed", farmId: "f", kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null, onHand: 1_250_500 },
        { id: "old", farmId: "f", kind: "vaccine", name: "HB1", unit: "dose", lot: "L1", expiresOn: "2026-12-30", onHand: 500 },
        { id: "last-day", farmId: "f", kind: "vaccine", name: "HB1", unit: "dose", lot: "L2", expiresOn: "2026-12-31", onHand: 1000 },
      ],
      new Map([["open", 575], ["feed", 1_200_000]]),
    );
    expect(lines.map((l) => [l.id, l.book, l.counted, l.gap])).toEqual([
      ["open", 570, 575, 5],
      ["still-open", 1000, null, null],
      ["feed", 1_250_500, 1_200_000, -50_500],
      ["old", 500, null, null],
      ["last-day", 1000, null, null],
    ]);
    expect(lines.filter((l) => l.kind === "stock" && l.expired).map((l) => l.id)).toEqual(["old"]); // still good on its expiry day
  });

  it("reads a count typed in the line's unit; 0 is a count", () => {
    const feed = { kind: "stock", unit: "kg" } as CountLine;
    const birds = { kind: "batch" } as CountLine;
    expect(parseCounted("1 250,5", feed)).toBe(1_250_500);
    expect(parseCounted("0", feed)).toBe(0);
    expect(parseCounted("0,000", feed)).toBe(0);
    expect(parseCounted("1,0001", feed)).toBeNull(); // finer than a gram
    expect(parseCounted("575", birds)).toBe(575);
    expect(parseCounted("12,5", birds)).toBeNull();
    expect(parseCounted("-3", birds)).toBeNull();
    expect(parseCounted("3000000000", birds)).toBeNull();
  });
});
