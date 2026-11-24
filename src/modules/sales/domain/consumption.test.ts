import { describe, expect, it } from "vitest";
import { lastPrices } from "@/modules/sales/domain/consumption";

describe("home consumption price (SPEC-finance FC7, FQ21)", () => {
  const sales = [
    { id: "02", day: "2026-11-10", kind: "live" as const, pricePerKgCentimes: "1500" },
    { id: "01", day: "2026-11-10", kind: "live" as const, pricePerKgCentimes: "1400" },
    { id: "03", day: "2026-11-12", kind: "live" as const, pricePerKgCentimes: "1700", takenBy: "employee" as const }, // a consumption, not a sale
    { id: "04", day: "2026-11-20", kind: "live" as const, pricePerKgCentimes: "1800" }, // after the day
    { id: "05", day: "2026-11-01", kind: "eggs" as const, lines: [{ item: "grade:m", unitPriceCentimes: "3300" }, { item: "grade:l", unitPriceCentimes: "3600" }] },
    { id: "06", day: "2026-11-05", kind: "eggs" as const, lines: [{ item: "grade:m", unitPriceCentimes: "3400" }] },
  ];

  it("takes each product's price from the farm's last sale of it on or before the day, consumptions aside", () => {
    expect(lastPrices(sales, "live", "2026-11-15")).toEqual(new Map([["kg", 1500n]])); // same day: the later id
    expect(lastPrices(sales, "eggs", "2026-11-15")).toEqual(new Map([["grade:m", 3400n], ["grade:l", 3600n]])); // by item
    expect(lastPrices(sales, "perHead", "2026-11-15")).toEqual(new Map()); // never sold: no price
    expect(lastPrices(sales, "live", "2026-11-09")).toEqual(new Map());
  });
});
