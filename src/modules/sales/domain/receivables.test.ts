import { describe, expect, it } from "vitest";
import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { ageing, ageingBucket, buyerBalances, checkPayment } from "@/modules/sales/domain/receivables";

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

describe("ageing (SPEC-finance FN12, §7)", () => {
  it("puts a debt in its column by days past due: due 20 Aug, today 5 Nov → 77 days → 61–90", () => {
    expect(ageingBucket(daysBetween("2026-08-20" as FarmDay, "2026-11-05" as FarmDay))).toBe("61-90");
    expect([0, 1, 30, 31, 60, 61, 90, 91, -3].map(ageingBucket)).toEqual(["notDue", "1-30", "1-30", "31-60", "31-60", "61-90", "61-90", "90+", "notDue"]);
  });

  it("settles the oldest debts first with later payments", () => {
    const today = "2026-11-05" as FarmDay;
    const past = (dueOn: string) => daysBetween(dueOn as FarmDay, today);
    const debts = [
      { dueOn: "2026-10-20", amountCentimes: 300_000n }, // 16 days
      { dueOn: "2026-08-20", amountCentimes: 500_000n }, // 77 days
      { dueOn: "2026-11-30", amountCentimes: 100_000n }, // not due yet
    ];
    expect(ageing(debts, 600_000n, past)).toEqual({ notDue: 100_000n, "1-30": 200_000n, "31-60": 0n, "61-90": 0n, "90+": 0n });
    expect(ageing(debts, 0n, past)).toEqual({ notDue: 100_000n, "1-30": 300_000n, "31-60": 0n, "61-90": 500_000n, "90+": 0n });
  });
});
