import { describe, expect, it } from "vitest";
import { closeAction, closeSource } from "@/modules/finance/domain/close";

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
});
