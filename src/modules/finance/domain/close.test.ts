import { describe, expect, it } from "vitest";
import { CLOSE_KINDS, REVERSED_AT_OPENING, closeAction, closeSource, openingSource, reversalSource } from "@/modules/finance/domain/close";

const lines = (amount: bigint) => [{ account: "6193", debit: amount, credit: 0n }, { account: "2833", debit: 0n, credit: amount }];

describe("the close run's versions (SPEC-finance FCX4, FN7, T103)", () => {
  it("posts a first version, nothing for the same figures, a reversal and a new version for changed ones, the reversal alone at zero", () => {
    const posted = { day: "2026-12-31", lines: lines(225_476n) };
    expect(closeAction(null, null)).toBe("none");
    expect(closeAction(null, posted)).toBe("post");
    expect(closeAction(posted, { day: "2026-12-31", lines: [...lines(225_476n)].reverse() })).toBe("unchanged"); // in any order
    expect(closeAction(posted, { day: "2026-12-31", lines: lines(315_667n) })).toBe("repost");
    expect(closeAction(posted, null)).toBe("reverse");
  });

  it("keys each kind's entry by legal entity and year", () => {
    expect(closeSource("depreciation", "e1", 2026)).toBe("close:depreciation:e1:2026");
  });

  it("keys the opening by the first day it opens, and a kind's reversal by the close entry it reverses (FCX5, T104)", () => {
    expect(openingSource("e1", "2027-01-01")).toBe("opening:e1:2027-01-01");
    expect(reversalSource("depreciation", "e1", 2026)).toBe("reversal:close:depreciation:e1:2026");
  });

  it("never reverses depreciation or the subsidy release at the opening, always stocks and provisions; every kind says whether it is reversed (FCX5)", () => {
    expect(REVERSED_AT_OPENING.depreciation).toBe(false);
    expect(REVERSED_AT_OPENING.subsidy).toBe(false);
    expect(REVERSED_AT_OPENING.interest).toBe(true); // FQ16: the accrued interest, D 4493 / C 63111 on the first day
    expect(REVERSED_AT_OPENING.stock).toBe(true); // T108
    expect(REVERSED_AT_OPENING.batch).toBe(true); // T109
    expect(REVERSED_AT_OPENING.provision).toBe(true);
    expect(Object.keys(REVERSED_AT_OPENING).sort()).toEqual([...CLOSE_KINDS].sort());
  });
});
