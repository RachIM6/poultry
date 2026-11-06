import { describe, expect, it } from "vitest";
import { parseCentimes } from "@/lib/kernel/money";
import { checkAdjustment, checkItem, checkPurchase, crossedBelow, parseQuantity, purchaseAmount, stockOnHand, supplierBalances } from "./stock";

describe("stock on hand (SPEC S3)", () => {
  it("is the sum of each item's movements: in, out and corrections", () => {
    const onHand = stockOnHand([
      { stockItemId: "starter", quantity: 2_000_000 }, // purchase 2 t
      { stockItemId: "starter", quantity: -350_500 }, // consumption
      { stockItemId: "starter", quantity: -1_000 }, // adjustment: spilled
      { stockItemId: "gumboro", quantity: 5_000 },
    ]);
    expect(Object.fromEntries(onHand)).toEqual({ starter: 1_648_500, gumboro: 5_000 });
    expect(stockOnHand([]).size).toBe(0);
  });
});

describe("parseQuantity", () => {
  it("reads kilograms to the gram and counts as whole numbers, without floats", () => {
    expect(parseQuantity("1 250,5", "kg")).toBe(1_250_500);
    expect(parseQuantity("0.125", "kg")).toBe(125);
    expect(parseQuantity("2000", "dose")).toBe(2000);
  });

  it("rejects zero, negatives, too many decimals and text", () => {
    for (const [text, unit] of [["0", "kg"], ["-5", "kg"], ["1,2345", "kg"], ["2,5", "dose"], ["abc", "unit"], ["", "ml"]] as const) {
      expect(parseQuantity(text, unit), `${text} ${unit}`).toBeNull();
    }
  });
});

describe("purchases and supplier credit (SPEC S2)", () => {
  it("prices quantity × unit price exactly, rounding half up to the centime", () => {
    expect(purchaseAmount(2_000_000, "kg", 450n)).toBe(900_000n); // 2 000 kg × 4,50 DH = 9 000,00 DH
    expect(purchaseAmount(1_001, "kg", 333n)).toBe(333n); // 1,001 kg × 3,33 = 3,33333 → 3,33
    expect(purchaseAmount(1_500, "kg", 333n)).toBe(500n); // 1,5 × 3,33 = 4,995 → 5,00
    expect(purchaseAmount(5_000, "dose", 12n)).toBe(60_000n);
    expect(purchaseAmount(10 ** 12, "kg", 10n ** 9n)).toBe(10n ** 18n); // no Number overflow
  });

  it("turns what isn't paid into credit, and refuses impossible purchases", () => {
    const base = { quantity: 2_000_000, unit: "kg" as const, unitPriceCentimes: 450n, paidCentimes: 300_000n, dueOn: "2026-12-15" };
    expect(checkPurchase(base)).toEqual({ ok: true, value: { amountCentimes: 900_000n, creditCentimes: 600_000n } });
    expect(checkPurchase({ ...base, paidCentimes: 900_001n })).toEqual({ ok: false, error: "PAID_MORE_THAN_AMOUNT" });
    expect(checkPurchase({ ...base, paidCentimes: 900_000n })).toEqual({ ok: false, error: "DUE_DATE_WITHOUT_CREDIT" });
    expect(checkPurchase({ ...base, paidCentimes: 900_000n, dueOn: null }).ok).toBe(true);
    expect(checkPurchase({ ...base, quantity: 0 })).toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });

  it("owes each supplier its purchases minus what was paid", () => {
    const balances = supplierBalances([
      { supplierId: "alf", amountCentimes: 900_000n, paidCentimes: 300_000n },
      { supplierId: "alf", amountCentimes: 450_000n, paidCentimes: 0n },
      { supplierId: "vet", amountCentimes: 60_000n, paidCentimes: 60_000n },
    ]);
    expect(Object.fromEntries(balances)).toEqual({ alf: 1_050_000n, vet: 0n });
  });

  it("reads amounts typed in dirhams exactly", () => {
    expect(parseCentimes("4,50")).toBe(450n);
    expect(parseCentimes("1 234,5")).toBe(123_450n);
    expect(parseCentimes("12")).toBe(1200n);
    expect(parseCentimes("4,505")).toBeNull();
    expect(parseCentimes("-3")).toBeNull();
  });
});

describe("items and adjustments (SPEC S1, S3)", () => {
  it("needs a lot and an expiry for vaccines and medicines only", () => {
    expect(checkItem({ kind: "vaccine", lot: "L2611", expiresOn: "2027-01-31" }).ok).toBe(true);
    expect(checkItem({ kind: "medicine", lot: null, expiresOn: "2027-01-31" })).toEqual({ ok: false, error: "LOT_REQUIRED" });
    expect(checkItem({ kind: "vaccine", lot: "L2611", expiresOn: null })).toEqual({ ok: false, error: "LOT_REQUIRED" });
    expect(checkItem({ kind: "feed", lot: null, expiresOn: null }).ok).toBe(true);
  });

  it("records a correction only with a reason and a non-zero quantity", () => {
    expect(checkAdjustment({ quantity: -1_000, reason: "Sac déchiré" }).ok).toBe(true);
    expect(checkAdjustment({ quantity: -1_000, reason: "  " })).toEqual({ ok: false, error: "REASON_REQUIRED" });
    expect(checkAdjustment({ quantity: 0, reason: "x" })).toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });
});

describe("low-stock threshold (SPEC S6)", () => {
  it("alerts only on the movement that crosses below, and again after a restock", () => {
    const threshold = 500_000; // 500 kg
    const ledger = [600_000, 450_000, 300_000, 900_000, 400_000]; // stock after each movement, from 1 000 kg
    let before = 1_000_000;
    const alerts = ledger.map((after) => {
      const crossed = crossedBelow(before, after, threshold);
      before = after;
      return crossed;
    });
    expect(alerts).toEqual([false, true, false, false, true]);
    expect(crossedBelow(1_000, 0, null)).toBe(false); // no threshold set
  });
});
