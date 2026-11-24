import { describe, expect, it } from "vitest";
import { divHalfUp } from "@/lib/kernel/money";

describe("divHalfUp", () => {
  it("rounds to the nearest integer, an exact half going up", () => {
    expect(divHalfUp(10n, 4n)).toBe(3n); // 2,5
    expect(divHalfUp(9n, 4n)).toBe(2n); // 2,25
    expect(divHalfUp(11n, 4n)).toBe(3n); // 2,75
    expect(divHalfUp(12n, 4n)).toBe(3n);
    expect(divHalfUp(0n, 7n)).toBe(0n);
    expect(divHalfUp(1n, 3n)).toBe(0n);
    expect(divHalfUp(2n, 3n)).toBe(1n);
  });

  it("rounds a signed amount symmetrically: a half away from zero", () => {
    expect(divHalfUp(-10n, 4n)).toBe(-3n); // −2,5
    expect(divHalfUp(-9n, 4n)).toBe(-2n);
    expect(divHalfUp(-11n, 4n)).toBe(-3n);
    expect(divHalfUp(10n, -4n)).toBe(-3n);
    expect(divHalfUp(-10n, -4n)).toBe(3n);
    expect(divHalfUp(-1n, 3n)).toBe(0n);
  });

  it("matches SPEC-finance §7 fixtures", () => {
    expect(divHalfUp(90_000_000n, 28n)).toBe(3_214_286n); // 900 000 / 28 quarters → 32 142,86
    expect(divHalfUp(27_080_000n * 1000n, 23_700_000n)).toBe(1143n); // 270 800,00 ÷ 23 700 kg → 11,43 DH/kg
  });
});
