import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { checkTick, checkUntick, reconciliation, type BankLine } from "@/modules/finance/domain/bank";

const d = (day: string) => day as FarmDay;
const line = (id: string, day: string, amount: bigint, match: BankLine["match"] = null): BankLine => ({ id, day: d(day), amount, match });

// Two weeks of a bank account, 1–14 March 2026. The statement to 14 March has the first four lines; the insurance
// cheque of 13 March isn't at the bank yet, and the 16 March line is after the statement.
const march = { id: "s1", endDay: d("2026-03-14"), closingCentimes: 4_350_000n }; // 50 000 − 1 200 − 300 − 5 000 = 43 500,00
const lines = [
  line("deposit", "2026-03-02", 5_000_000n), // cash deposited, D 5141
  line("power", "2026-03-05", -120_000n), // electricity paid by the bank
  line("water", "2026-03-09", -30_000n),
  line("withdrawal", "2026-03-12", -500_000n), // cash withdrawn
  line("insurance", "2026-03-13", -80_000n), // a cheque not yet cashed
  line("later", "2026-03-16", -10_000n),
];
const tick = (ls: BankLine[], ids: string[], s = march) => ls.map((l) => (ids.includes(l.id) ? { ...l, match: { statementId: s.id, endDay: s.endDay } } : l));

describe("bank reconciliation (SPEC-finance FC9)", () => {
  it("two-week fixture: ticking the statement's lines brings the difference to 0", () => {
    const before = reconciliation(march, lines);
    expect(before).toMatchObject({ bookCentimes: 4_270_000n, tickedCentimes: 0n, differenceCentimes: 4_350_000n, reconciled: false });
    expect(before.unticked.map((l) => l.id)).toEqual(["deposit", "power", "water", "withdrawal", "insurance"]); // not the 16th

    const after = reconciliation(march, tick(lines, ["deposit", "power", "water", "withdrawal"]));
    expect(after).toMatchObject({ bookCentimes: 4_270_000n, tickedCentimes: 4_350_000n, differenceCentimes: 0n, reconciled: true });
    expect(after.unticked.map((l) => l.id)).toEqual(["insurance"]);
  });

  it("leaves a statement line missing from the books in the difference", () => {
    const fee = { ...march, closingCentimes: march.closingCentimes - 2_500n }; // a bank fee not booked yet (T119)
    expect(reconciliation(fee, tick(lines, ["deposit", "power", "water", "withdrawal"])).differenceCentimes).toBe(-2_500n);
  });

  it("counts lines ticked on an earlier statement as at the bank, and those ticked on a later one as unticked", () => {
    const first = { id: "s0", endDay: d("2026-03-07"), closingCentimes: 4_880_000n };
    const ticked = tick(tick(lines, ["deposit", "power"], first), ["water", "withdrawal"]);
    expect(reconciliation(march, ticked)).toMatchObject({ tickedCentimes: -530_000n, differenceCentimes: 0n, reconciled: true });
    const early = reconciliation(first, ticked);
    expect(early).toMatchObject({ bookCentimes: 4_880_000n, differenceCentimes: 0n });
    expect(early.unticked).toEqual([]); // water and withdrawal are after 7 March
    const late = tick(lines, ["power"], { id: "s2", endDay: d("2026-03-31"), closingCentimes: 0n });
    expect(reconciliation(first, late).unticked.map((l) => l.id)).toEqual(["deposit", "power"]);
  });

  it("ticks a line once, on or before the end day, while its month is open", () => {
    const none = new Set<string>();
    expect(checkTick(lines[0], march, none)).toEqual({ ok: true, value: undefined });
    expect(checkTick(lines[5], march, none)).toEqual({ ok: false, error: "LINE_AFTER_STATEMENT" });
    expect(checkTick(tick(lines, ["deposit"], { ...march, id: "other" })[0], march, none)).toEqual({ ok: false, error: "LINE_ALREADY_TICKED" });
    expect(checkTick(lines[0], march, new Set(["2026-03"]))).toEqual({ ok: false, error: "PERIOD_LOCKED" });
  });

  it("unticks on its own statement only, until the month is locked", () => {
    const [ticked] = tick(lines, ["deposit"]);
    expect(checkUntick(ticked, march, new Set())).toEqual({ ok: true, value: undefined });
    expect(checkUntick(ticked, { ...march, id: "other" }, new Set())).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(checkUntick(lines[0], march, new Set())).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(checkUntick(ticked, march, new Set(["2026-03"]))).toEqual({ ok: false, error: "PERIOD_LOCKED" });
  });
});
