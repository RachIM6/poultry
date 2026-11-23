import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { checkLoan, checkSchedule, disbursementPosting, dueDay, installmentPosting, loanSchedule, type LoanTerms } from "@/modules/finance/domain/loans";

const day = (d: string) => d as FarmDay;
const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);
// SPEC-finance §7.1 B: 100 000,00 over 6 quarters, 5,55 %, first due day 31 Mar 2027.
const b: LoanTerms = { principal: 10_000_000n, rate: 5_550, frequency: "quarterly", installments: 6, deferral: 0, firstDueOn: day("2027-03-31") };

describe("loanSchedule (SPEC-finance FC2, §7, default FQ16)", () => {
  it("§7.1 B to the centime: 6 rows, the 31st clamped to the month's end, interest 4 856,25", () => {
    const rows = loanSchedule(b);
    expect(rows.map((r) => [r.number, r.dueOn, r.interest, r.capital])).toEqual([
      [1, "2027-03-31", 138_750n, 1_666_667n],
      [2, "2027-06-30", 115_625n, 1_666_667n],
      [3, "2027-09-30", 92_500n, 1_666_667n],
      [4, "2027-12-31", 69_375n, 1_666_667n],
      [5, "2028-03-31", 46_250n, 1_666_667n],
      [6, "2028-06-30", 23_125n, 1_666_665n],
    ]);
    expect(rows.map((r) => r.capital + r.interest)).toEqual([1_805_417n, 1_782_292n, 1_759_167n, 1_736_042n, 1_712_917n, 1_689_790n]);
    expect(sum(rows.map((r) => r.capital))).toBe(10_000_000n);
    expect(sum(rows.map((r) => r.interest))).toBe(485_625n);
    expect(sum(rows.map((r) => r.capital + r.interest))).toBe(10_485_625n);
  });

  it("§7: 900 000 over 28 quarters → 32 142,86, the last 32 142,78; the 9th quarter's interest 8 919,64", () => {
    const rows = loanSchedule({ ...b, principal: 90_000_000n, installments: 28 });
    expect(rows).toHaveLength(28);
    expect(rows[0].capital).toBe(3_214_286n);
    expect(rows[27].capital).toBe(3_214_278n);
    expect(90_000_000n - sum(rows.slice(0, 8).map((r) => r.capital))).toBe(64_285_712n); // 642 857,12 outstanding before the 9th
    expect(rows[8].interest).toBe(891_964n);
  });

  it("charges interest only during the deferral, then repays the capital; monthly is rate ÷ 12", () => {
    const rows = loanSchedule({ ...b, frequency: "monthly", installments: 2, deferral: 2, firstDueOn: day("2027-01-31") });
    expect(rows.map((r) => [r.dueOn, r.capital, r.interest])).toEqual([
      ["2027-01-31", 0n, 46_250n], // 10 000 000 × 5 550 ÷ 1 200 000
      ["2027-02-28", 0n, 46_250n],
      ["2027-03-31", 5_000_000n, 46_250n],
      ["2027-04-30", 5_000_000n, 23_125n],
    ]);
  });

  it("clamps each due day from the first one, not from the last", () => {
    expect([1, 2, 12, 13].map((k) => dueDay(day("2028-01-31"), k))).toEqual(["2028-02-29", "2028-03-31", "2029-01-31", "2029-02-28"]);
  });

  // Property (seeded, the same run every time): the capital adds up to the principal, the rows keep their order and
  // never go below zero; moving one centime of capital from any row refuses the confirmation.
  it("adds the capital up to the principal for any loan; an edit that doesn't is refused", () => {
    let seed = 11;
    const next = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    for (let run = 0; run < 2000; run++) {
      const installments = 1 + next(360);
      const t: LoanTerms = {
        principal: BigInt(100_000 + next(2_000_000_000)), // above n(n − 1) ÷ 2 centimes: the last row stays above zero
        rate: next(30_001),
        frequency: next(2) === 0 ? "monthly" : "quarterly",
        installments,
        deferral: next(3) === 0 ? next(12) : 0,
        firstDueOn: dueDay(day(`${2020 + next(20)}-${String(1 + next(12)).padStart(2, "0")}-${String(1 + next(31)).padStart(2, "0")}`), 0), // any day, clamped
      };
      const rows = loanSchedule(t);
      expect(rows, `run ${run}`).toHaveLength(t.deferral + installments);
      expect(sum(rows.map((r) => r.capital)), `run ${run}`).toBe(t.principal);
      expect(rows.every((r, i) => r.capital >= 0n && r.interest >= 0n && (i === 0 || r.dueOn > rows[i - 1].dueOn)), `run ${run}`).toBe(true);
      expect(rows.slice(0, t.deferral).every((r) => r.capital === 0n), `run ${run}`).toBe(true);
      expect(checkSchedule(t.principal, rows), `run ${run}`).toEqual({ ok: true, value: undefined });

      const edited = rows.map((r) => ({ ...r }));
      const i = next(edited.length);
      edited[i].capital += next(2) === 0 || edited[i].capital === 0n ? 1n : -1n;
      expect(checkSchedule(t.principal, edited), `run ${run}`).toEqual({ ok: false, error: "CAPITAL_NOT_PRINCIPAL" });
      // Adjusted to the bank's table: a centime moved between two rows, and any interest, still confirms.
      if (edited.length > 1) {
        const j = (i + 1) % edited.length;
        edited[j].capital -= edited[i].capital - rows[i].capital;
        edited[j].interest += 1n;
        if (edited[j].capital >= 0n) expect(checkSchedule(t.principal, edited), `run ${run}`).toEqual({ ok: true, value: undefined });
      }
    }
  });

  it("refuses a row below zero and a first due day on or before the disbursement", () => {
    expect(checkSchedule(2n, [{ capital: 3n, interest: 0n }, { capital: -1n, interest: 0n }])).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(checkLoan(day("2027-03-31"), day("2027-03-31"))).toEqual({ ok: false, error: "FIRST_DUE_BEFORE_DISBURSEMENT" });
    expect(checkLoan(day("2027-01-15"), day("2027-03-31")).ok).toBe(true);
    expect(checkLoan(null, day("2020-03-31")).ok).toBe(true); // in the opening balance
  });

  it("never computes a row below zero, even for a tiny principal over many rows", () => {
    const rows = loanSchedule({ ...b, principal: 7n, installments: 10 });
    expect(rows.map((r) => r.capital)).toEqual([1n, 1n, 1n, 1n, 1n, 1n, 1n, 0n, 0n, 0n]);
    expect(checkSchedule(7n, rows).ok).toBe(true);
  });
});

describe("loan entries (FC2, §7.1 B step 5)", () => {
  it("disbursement D 5141 / C 1481; installment 1 D 1481 16 666,67, D 63111 1 387,50 / C 5141 18 054,17, BQ", () => {
    expect(disbursementPosting("BMCE", 10_000_000n, "bank-1")).toEqual({
      journal: "BQ",
      label: "Déblocage d’emprunt : BMCE",
      lines: [{ account: "5141", debit: 10_000_000n, credit: 0n, treasuryId: "bank-1" }, { account: "1481", debit: 0n, credit: 10_000_000n }],
    });
    const [first] = loanSchedule(b);
    expect(installmentPosting("BMCE", first, "bank-1")).toEqual({
      journal: "BQ",
      label: "Échéance d’emprunt n° 1 : BMCE",
      lines: [
        { account: "1481", debit: 1_666_667n, credit: 0n },
        { account: "63111", debit: 138_750n, credit: 0n },
        { account: "5141", debit: 0n, credit: 1_805_417n, treasuryId: "bank-1" },
      ],
    });
  });

  it("leaves out a line of nothing: a deferral row is interest only, a row of nothing posts nothing", () => {
    expect(installmentPosting("BMCE", { number: 1, capital: 0n, interest: 46_250n }, "bank-1")?.lines.map((l) => l.account)).toEqual(["63111", "5141"]);
    expect(installmentPosting("BMCE", { number: 1, capital: 0n, interest: 0n }, "bank-1")).toBeNull();
  });

  it("§7.1 B: 1481 at 31 Dec 2027 is 33 333,32 credit; 63111 is 4 162,50 for 2027 and 693,75 for 2028", () => {
    const rows = loanSchedule(b);
    expect(10_000_000n - sum(rows.slice(0, 4).map((r) => r.capital))).toBe(3_333_332n);
    expect(sum(rows.filter((r) => r.dueOn <= "2027-12-31").map((r) => r.interest))).toBe(416_250n);
    expect(sum(rows.filter((r) => r.dueOn > "2027-12-31").map((r) => r.interest))).toBe(69_375n);
  });
});
