import { describe, expect, it } from "vitest";
import { medianDays, shifted } from "@/modules/finance/domain/payment-delay";

describe("a budget input's supplier payment delay (SPEC-finance FN15, §9 \"Budget cash need\")", () => {
  it("is the median of the farm's last purchases, half up between the middle two, 0 with none", () => {
    expect(medianDays([])).toBe(0);
    expect(medianDays([30])).toBe(30);
    expect(medianDays([45, 0, 30])).toBe(30); // order doesn't matter
    expect(medianDays([0, 30, 45, 60])).toBe(38); // 37,5 rounds up (§7)
    expect(medianDays([0, 0, 0, 30])).toBe(0); // most bought cash: paid on the day
    expect(medianDays([14, 15])).toBe(15);
  });

  it("moves each day's amount by whole days, never earlier", () => {
    expect(shifted([1n, 2n], 3)).toEqual([0n, 0n, 0n, 1n, 2n]);
    expect(shifted([1n, 2n], 0)).toEqual([1n, 2n]);
    expect(shifted([1n], -4)).toEqual([1n]);
    expect(shifted([1n], 1.9)).toEqual([0n, 1n]);
  });
});
