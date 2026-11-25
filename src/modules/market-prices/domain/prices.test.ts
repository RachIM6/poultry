import { describe, expect, it } from "vitest";
import { latestByProduct, type PriceDto } from "./prices";

// SPEC-m5 MP2: per product, the latest price and its change against the one before. Made-up prices.
const p = (id: string, product: PriceDto["product"], day: string, priceCentimes: string): PriceDto => ({ id, product, day, priceCentimes, seenOn: null, byUserId: "u" });

describe("latest price per product (MP2)", () => {
  it("takes the latest day, the later record on the same day, and the change from the one before", () => {
    const rows = latestByProduct([
      p("0197a000-0000-7000-8000-000000000001", "liveBroiler", "2026-11-10", "1350"),
      p("0197a000-0000-7000-8000-000000000003", "liveBroiler", "2026-11-12", "1400"),
      p("0197a000-0000-7000-8000-000000000002", "liveBroiler", "2026-11-12", "1380"), // same day, recorded earlier
      p("0197a000-0000-7000-8000-000000000004", "egg", "2026-11-11", "110"),
    ]);
    expect(rows).toEqual([
      { product: "liveBroiler", latest: expect.objectContaining({ priceCentimes: "1400" }), changeCentimes: 20n },
      { product: "egg", latest: expect.objectContaining({ priceCentimes: "110" }), changeCentimes: null },
    ]);
  });

  it("lists products in the fixed order and leaves out those never recorded", () => {
    expect(latestByProduct([]).length).toBe(0);
    const rows = latestByProduct([p("0197a000-0000-7000-8000-000000000005", "cullHen", "2026-11-01", "3500"), p("0197a000-0000-7000-8000-000000000006", "chick", "2026-11-01", "450")]);
    expect(rows.map((r) => r.product)).toEqual(["chick", "cullHen"]);
  });
});
