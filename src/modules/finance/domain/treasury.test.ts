import { describe, expect, it } from "vitest";
import { expensePosting, onDefaultTreasury, transferPostings } from "@/modules/finance/domain/treasury";

describe("quick expenses and transfers (SPEC-finance FN6)", () => {
  it("charges each category to its account, against the cash box, the bank or the supplier", () => {
    expect(expensePosting({ category: "electricity", amount: 120_000n, paidFrom: "cash", treasuryId: "box" })).toEqual({
      journal: "CA",
      label: "Dépense",
      lines: [{ account: "612512", debit: 120_000n, credit: 0n }, { account: "5161", debit: 0n, credit: 120_000n, treasuryId: "box" }],
    });
    expect(expensePosting({ category: "vet_fees", amount: 5n, paidFrom: "bank", treasuryId: null })).toMatchObject({ journal: "BQ", lines: [{ account: "6136" }, { account: "5141" }] });
    expect(expensePosting({ category: "bank_fees", amount: 4_500n, paidFrom: "bank", treasuryId: "bp" })).toEqual({
      journal: "BQ",
      label: "Dépense",
      lines: [{ account: "61473", debit: 4_500n, credit: 0n }, { account: "5141", debit: 0n, credit: 4_500n, treasuryId: "bp" }],
    }); // FC9 (T119)
    expect(expensePosting({ category: "catching", amount: 5n, paidFrom: "credit", treasuryId: "ignored" })).toMatchObject({
      journal: "AC",
      lines: [{ account: "612612" }, { account: "4411", treasuryId: null }],
    });
  });

  it("moves cash to the bank through 5115 in two balanced entries", () => {
    const [out, into] = transferPostings({ amount: 500_000n, from: { id: "box", kind: "cash" }, to: { id: "bmce", kind: "bank" } });
    expect(out).toEqual({ journal: "CA", label: "Virement de fonds", lines: [{ account: "5115", debit: 500_000n, credit: 0n }, { account: "5161", debit: 0n, credit: 500_000n, treasuryId: "box" }] });
    expect(into).toEqual({ journal: "BQ", label: "Virement de fonds", lines: [{ account: "5141", debit: 500_000n, credit: 0n, treasuryId: "bmce" }, { account: "5115", debit: 0n, credit: 500_000n }] });
  });
});

describe("quick expense VAT (SPEC-finance FN9)", () => {
  const bill = { category: "electricity", amount: 120_000n, paidFrom: "cash", treasuryId: "box", vat: 20_000n } as const;
  it("books a registered entity's VAT on 34552 and the rest on the charge", () => {
    expect(expensePosting(bill, true).lines).toEqual([
      { account: "612512", debit: 100_000n, credit: 0n },
      { account: "34552", debit: 20_000n, credit: 0n },
      { account: "5161", debit: 0n, credit: 120_000n, treasuryId: "box" },
    ]);
  });
  it("keeps the whole bill on the charge otherwise", () => {
    expect(expensePosting(bill).lines[0]).toEqual({ account: "612512", debit: 120_000n, credit: 0n });
    expect(expensePosting(bill).lines).toHaveLength(2);
  });
});

describe("default cash box and bank account (SPEC-finance §9)", () => {
  it("puts a 5141 / 5161 line that names no account on the default of its kind, and leaves every other line", () => {
    const lines = [
      { account: "5161", debit: 5n, credit: 0n },
      { account: "5141", debit: 0n, credit: 3n, treasuryId: null },
      { account: "5141", debit: 0n, credit: 2n, treasuryId: "named" },
      { account: "3421", debit: 0n, credit: 0n },
    ];
    expect(onDefaultTreasury(lines, { cash: "box", bank: "bank" }).map((l) => l.treasuryId)).toEqual(["box", "bank", "named", undefined]);
    expect(onDefaultTreasury(lines, { cash: "box" }).map((l) => l.treasuryId)).toEqual(["box", null, "named", undefined]); // no bank account yet
  });
});
