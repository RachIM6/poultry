// Money is integer centimes (bigint), never a float (SPEC §5). Parsing works on the digits, not through Number.

/** "1 234,50", "1234.5" or "12" (dirhams) → centimes; null when it isn't an amount with at most 2 decimals. */
export function parseCentimes(text: string): bigint | null {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.replace(/[\s  ]/g, ""));
  return m ? BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0")) : null;
}
