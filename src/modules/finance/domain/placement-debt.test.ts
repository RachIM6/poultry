import { describe, expect, it } from "vitest";
import { checkPlacementPayment, placementDebt, placementPaymentPosting } from "@/modules/finance/domain/placement-debt";

// 1 000 chicks at 5,50: D 612121 / C 4411 5 500,00 (FN6); 500 point-of-lay hens at 60,00, classic: D 23711 / C 4481 (FC6).
const chicks = (id: string, version: number, amount: bigint, debt = "4411") => ({
  id,
  version,
  lines: [
    { account: debt === "4481" ? "23711" : "612121", debit: amount, credit: 0n },
    { account: debt, debit: 0n, credit: amount },
  ],
});

describe("placementDebt (SPEC-finance FN6, FC6, §9 placement debts)", () => {
  it("is the standing entry's credit less what was paid, on its account", () => {
    expect(placementDebt([chicks("a", 1, 550_000n)], new Set(), 0n)).toEqual({ account: "4411", owed: 550_000n });
    expect(placementDebt([chicks("a", 1, 550_000n)], new Set(), 200_000n)).toEqual({ account: "4411", owed: 350_000n });
    expect(placementDebt([chicks("h", 1, 3_000_000n, "4481")], new Set(), 0n)).toEqual({ account: "4481", owed: 3_000_000n });
  });

  it("takes the latest version; nothing when it is reversed or nothing was posted", () => {
    expect(placementDebt([chicks("a", 1, 550_000n), chicks("b", 2, 3_000_000n, "4481")], new Set(["a"]), 0n)).toEqual({ account: "4481", owed: 3_000_000n });
    expect(placementDebt([chicks("b", 2, 600_000n), chicks("a", 1, 550_000n)], new Set(["a"]), 0n)).toEqual({ account: "4411", owed: 600_000n });
    expect(placementDebt([chicks("a", 1, 550_000n)], new Set(["a"]), 0n)).toBeNull();
    expect(placementDebt([], new Set(), 0n)).toBeNull();
  });
});

describe("checkPlacementPayment: capped at what is still owed", () => {
  const debt = { account: "4411", owed: 550_000n };
  it("accepts up to the amount owed, refuses above it", () => {
    expect(checkPlacementPayment(debt, 550_000n)).toEqual({ ok: true, value: debt });
    expect(checkPlacementPayment(debt, 1n)).toEqual({ ok: true, value: debt });
    expect(checkPlacementPayment(debt, 550_001n)).toEqual({ ok: false, error: "PAID_MORE_THAN_OWED" });
  });
  it("refuses when nothing is owed: paid off, overpaid by hand, or nothing posted", () => {
    expect(checkPlacementPayment({ account: "4411", owed: 0n }, 1n)).toEqual({ ok: false, error: "NOTHING_OWED" });
    expect(checkPlacementPayment({ account: "4411", owed: -100n }, 1n)).toEqual({ ok: false, error: "NOTHING_OWED" });
    expect(checkPlacementPayment(null, 1n)).toEqual({ ok: false, error: "NOTHING_OWED" });
  });
});

describe("placementPaymentPosting", () => {
  it("debits the debt's account and credits the cash box (CA) or the bank (BQ), tagged", () => {
    expect(placementPaymentPosting({ account: "4411", owed: 550_000n }, 200_000n, "cash", "box", "Couvoir Atlas")).toEqual({
      journal: "CA",
      label: "Paiement fournisseur : Couvoir Atlas",
      lines: [
        { account: "4411", debit: 200_000n, credit: 0n },
        { account: "5161", debit: 0n, credit: 200_000n, treasuryId: "box" },
      ],
    });
    for (const method of ["transfer", "cheque"] as const) {
      const p = placementPaymentPosting({ account: "4481", owed: 3_000_000n }, 3_000_000n, method, null, "H");
      expect([p.journal, p.lines.map((l) => [l.account, l.debit, l.credit])]).toEqual(["BQ", [["4481", 3_000_000n, 0n], ["5141", 0n, 3_000_000n]]]);
    }
  });
});
