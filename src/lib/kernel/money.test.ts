import { describe, expect, it } from "vitest";
import { divHalfUp, parseCentimes, typedCentimes } from "@/lib/kernel/money";

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

describe("typedCentimes", () => {
  it("writes centimes as a field takes them: decimal comma, two decimals, no thousands separator", () => {
    expect(typedCentimes(123450n)).toBe("1234,50");
    expect(typedCentimes(5n)).toBe("0,05");
    expect(typedCentimes(0n)).toBe("0,00");
    expect(typedCentimes(1_666_667n)).toBe("16666,67");
    expect(typedCentimes(4500n, ".")).toBe("45.00");
  });

  it("keeps a negative amount's sign on the whole amount", () => {
    expect(typedCentimes(-5n)).toBe("-0,05");
    expect(typedCentimes(-123450n)).toBe("-1234,50");
    expect(typedCentimes(-100n, ".")).toBe("-1.00");
  });

  it("reads back as the same centimes", () => {
    for (const c of [0n, 5n, 99n, 100n, 123450n]) expect(parseCentimes(typedCentimes(c))).toBe(c);
  });
});
