import { describe, expect, it } from "vitest";
import { associatePosting } from "@/modules/finance/domain/contribution";

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
