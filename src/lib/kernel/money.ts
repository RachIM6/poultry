// Money is integer centimes (bigint), never a float (SPEC §5). Parsing works on the digits, not through Number.

/** "1 234,50", "1234.5" or "12" (dirhams) → centimes; null when it isn't an amount with at most 2 decimals. */
export function parseCentimes(text: string): bigint | null {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.replace(/[\s  ]/g, ""));
  return m ? BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0")) : null;
}

/**
 * n ÷ d rounded half up (SPEC-finance §7.1: "0,5 going up"), the one rounding of the app. A signed amount rounds the
 * same on both sides, a half away from zero (−2,5 → −3), so a loss rounds like the gain it mirrors. d ≠ 0.
 */
export function divHalfUp(n: bigint, d: bigint): bigint {
  const a = n < 0n ? -n : n;
  const b = d < 0n ? -d : d;
  const q = (2n * a + b) / (2n * b);
  return n < 0n !== d < 0n ? -q : q;
}

/**
 * 123450n → "1234,50": an amount as typed into a field, and as French Excel reads a number (no thousands separator).
 * `point` "." for the fields and files that take one. A negative amount keeps its sign: −5n → "-0,05".
 */
export function typedCentimes(centimes: bigint, point = ","): string {
  const abs = centimes < 0n ? -centimes : centimes;
  return `${centimes < 0n ? "-" : ""}${abs / 100n}${point}${String(abs % 100n).padStart(2, "0")}`;
}
