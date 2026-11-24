import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { monthOf } from "@/modules/finance/domain/entry";

// SPEC-finance FC9: bank reconciliation by manual matching. Pure, in centimes.

/** A 5141 line of one bank account: its farm day, debit − credit, and the statement it is ticked on, if any. */
export type BankLine = { id: string; day: FarmDay; amount: bigint; match: { statementId: string; endDay: FarmDay } | null };
export type Statement = { id: string; endDay: FarmDay; closingCentimes: bigint };

/**
 * The book balance is every line of the account up to the end day included. A line is on the bank's side when it is
 * ticked on this statement or an earlier one; the others up to the end day are unticked (in the books, not yet at the
 * bank). Difference = closing balance − (book balance − unticked); "rapproché" at 0. A statement line missing from
 * the books stays in the difference until it is booked.
 */
export function reconciliation(statement: Statement, lines: readonly BankLine[]) {
  const upTo = lines.filter((l) => l.day <= statement.endDay);
  const sum = (ls: readonly BankLine[]) => ls.reduce((s, l) => s + l.amount, 0n);
  const unticked = upTo.filter((l) => !l.match || l.match.endDay > statement.endDay);
  const bookCentimes = sum(upTo);
  const differenceCentimes = statement.closingCentimes - (bookCentimes - sum(unticked));
  return {
    bookCentimes,
    tickedCentimes: sum(upTo.filter((l) => l.match?.statementId === statement.id)),
    unticked,
    differenceCentimes,
    reconciled: differenceCentimes === 0n,
  };
}

export type MatchError = "PERIOD_LOCKED" | "LINE_AFTER_STATEMENT" | "LINE_ALREADY_TICKED" | "NOT_FOUND";

/** A line is ticked on one statement at most, dated on or before its end day, while the line's month is open. */
export function checkTick(line: BankLine, statement: Statement, locked: ReadonlySet<string>): Result<void, MatchError> {
  if (locked.has(monthOf(line.day))) return fail("PERIOD_LOCKED");
  if (line.match) return fail("LINE_ALREADY_TICKED");
  if (line.day > statement.endDay) return fail("LINE_AFTER_STATEMENT");
  return ok(undefined);
}

/** A tick is undone on its own statement, until the line's month is locked. */
export function checkUntick(line: BankLine, statement: Statement, locked: ReadonlySet<string>): Result<void, MatchError> {
  if (line.match?.statementId !== statement.id) return fail("NOT_FOUND");
  if (locked.has(monthOf(line.day))) return fail("PERIOD_LOCKED");
  return ok(undefined);
}

/**
 * T117: hands an imported statement to the manual matching. Each statement line is paired with one book line of the
 * same amount: one already ticked on this statement first, else a line the owner can still tick here (not ticked,
 * up to the end day), the nearest in days. Unpaired: the line is missing from the books (or its amount differs).
 * A proposal only: the owner ticks (checkTick), nothing is ticked automatically (FC9 "out of scope").
 */
export function pairImported(statement: Statement, imported: readonly { id: string; day: FarmDay; amount: bigint }[], lines: readonly BankLine[]) {
  const pairs = new Map<string, { lineId: string; ticked: boolean }>();
  const distance = (a: FarmDay, b: FarmDay) => Math.abs(daysBetween(a, b));
  for (const ticked of [true, false]) {
    const pool = lines.filter((l) => (ticked ? l.match?.statementId === statement.id : !l.match && l.day <= statement.endDay));
    const taken = new Set([...pairs.values()].map((p) => p.lineId));
    for (const s of imported) {
      if (pairs.has(s.id)) continue;
      const best = pool.filter((l) => l.amount === s.amount && !taken.has(l.id)).sort((x, y) => distance(x.day, s.day) - distance(y.day, s.day))[0];
      if (best) {
        pairs.set(s.id, { lineId: best.id, ticked });
        taken.add(best.id);
      }
    }
  }
  return pairs;
}
