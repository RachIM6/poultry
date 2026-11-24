import { describe, expect, it } from "vitest";
import { associatePosting, cashBookAccount } from "@/modules/finance/domain/contribution";

describe("associatePosting (SPEC-finance FN6, FQ11, §9 associate contributions)", () => {
  const bank = { id: "b", kind: "bank" as const };
  const box = { id: "c", kind: "cash" as const };

  it("brings an associate's money in: D 5141 / C 4463 (BQ), named", () => {
    expect(associatePosting({ direction: "contribution", amount: 5_000_000n, treasury: bank, individual: false, associate: "Karim" })).toEqual({
      journal: "BQ",
      label: "Apport de l'associé : Karim",
      lines: [
        { account: "5141", debit: 5_000_000n, credit: 0n, treasuryId: "b" },
        { account: "4463", debit: 0n, credit: 5_000_000n, treasuryId: null },
      ],
    });
  });

  it("takes the exploitant's out of the cash box: D 1117 / C 5161 (CA)", () => {
    expect(associatePosting({ direction: "withdrawal", amount: 200_000n, treasury: box, individual: true, associate: null })).toEqual({
      journal: "CA",
      label: "Retrait de l'exploitant",
      lines: [
        { account: "1117", debit: 200_000n, credit: 0n, treasuryId: null },
        { account: "5161", debit: 0n, credit: 200_000n, treasuryId: "c" },
      ],
    });
  });
});

describe("cashBookAccount (SPEC-finance FN3, FCX3, FQ11)", () => {
  it("lets a cash_book entity's manual entry use only 5141, 5161 and the owner's account", () => {
    expect(["5141", "5161", "1117"].every((a) => cashBookAccount(a, true))).toBe(true);
    expect(["5141", "5161", "4463"].every((a) => cashBookAccount(a, false))).toBe(true);
    expect(["4463", "1111", "7140"].some((a) => cashBookAccount(a, true))).toBe(false);
    expect(cashBookAccount("1117", false)).toBe(false);
  });
});
