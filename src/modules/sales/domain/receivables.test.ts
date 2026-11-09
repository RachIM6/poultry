import { describe, expect, it } from "vitest";
import { buyerBalances, checkPayment } from "@/modules/sales/domain/receivables";

describe("receivables (SPEC V4)", () => {
  it("gives each buyer's balance as sales − payments, in centimes", () => {
    const sales = [
      { buyerId: "atlas", amountCentimes: 870_000n, paidCentimes: 870_000n }, // paid in cash: nothing owed
      { buyerId: "atlas", amountCentimes: 1_450_000n, paidCentimes: 0n }, // a cheque
      { buyerId: "souk", amountCentimes: 500_050n, paidCentimes: 100_000n },
    ];
    const payments = [
      { buyerId: "atlas", amountCentimes: 450_000n },
      { buyerId: "souk", amountCentimes: 400_050n },
    ];
    expect(buyerBalances(sales, payments)).toEqual(new Map([["atlas", 1_000_000n], ["souk", 0n]]));
    expect(buyerBalances([], [])).toEqual(new Map());
  });

  it("takes a payment of something, up to what is owed", () => {
    expect(checkPayment(1_000_000n, 1_000_000n).ok).toBe(true);
    expect(checkPayment(1_000_001n, 1_000_000n)).toEqual({ ok: false, error: "PAID_MORE_THAN_BALANCE" });
    expect(checkPayment(0n, 1_000_000n)).toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });
});
