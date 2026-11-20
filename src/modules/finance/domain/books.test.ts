import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { cashBookOf, trialBalance } from "@/modules/finance/domain/books";
import type { Line } from "@/modules/finance/domain/entry";
import { postingOf, type FarmEvent } from "@/modules/finance/domain/posting";
import { EXPENSE_CATEGORIES, expensePosting, PAID_FROM, transferPostings } from "@/modules/finance/domain/treasury";

const day = "2026-03-02" as FarmDay;
const line = (account: string, debit: bigint, credit: bigint): Line => ({ account, debit, credit });

describe("trial balance (SPEC-finance FN16)", () => {
  it("sums each account's debits and credits, in account order", () => {
    const tb = trialBalance([line("612122", 900_000n, 0n), line("4411", 0n, 600_000n), line("5161", 0n, 300_000n), line("4411", 200_000n, 0n), line("5161", 0n, 200_000n)]);
    expect(tb.rows).toEqual([
      { account: "4411", debit: 200_000n, credit: 600_000n, balance: -400_000n },
      { account: "5161", debit: 0n, credit: 500_000n, balance: -500_000n },
      { account: "612122", debit: 900_000n, credit: 0n, balance: 900_000n },
    ]);
    expect(tb).toMatchObject({ debit: 1_100_000n, credit: 1_100_000n, balanced: true });
  });

  it("stays balanced for any sequence of M1 events (property test)", () => {
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    const amount = () => BigInt(rand(5_000_000) + 1);
    const pick = <T,>(xs: readonly T[]) => xs[rand(xs.length)];
    for (let run = 0; run < 200; run++) {
      const lines: Line[] = [];
      for (let i = 0; i < rand(40) + 1; i++) {
        const kind = rand(6);
        const a = amount();
        const event: FarmEvent | null =
          kind === 0 ? { type: "purchase", id: "x", day, itemKind: pick(["feed", "vaccine", "medicine", "litter", "gas", "other"]), amount: a, paid: BigInt(rand(Number(a) + 1)) }
          : kind === 1 ? { type: "chicks", id: "x", day, amount: a }
          : kind === 2 ? { type: "sale", id: "x", day, amount: a, paid: BigInt(rand(Number(a) + 1)), method: pick(["cash", "cheque", "bill", "transfer", "credit"]) }
          : kind === 3 ? { type: "receipt", id: "x", day, amount: a, method: pick(["cash", "cheque", "bill", "transfer"]) }
          : kind === 4 ? { type: "instrument", id: "x", day, amount: a, kind: pick(["cheque", "bill"] as const), from: pick(["in_portfolio", "remitted"]), to: pick(["remitted", "cashed", "unpaid"]) }
          : null;
        if (event) lines.push(...(postingOf(event)?.lines ?? []));
        else if (rand(2) === 0) lines.push(...expensePosting({ category: pick(EXPENSE_CATEGORIES), amount: a, paidFrom: pick(PAID_FROM), treasuryId: null }).lines);
        else for (const p of transferPostings({ amount: a, from: { id: "c", kind: "cash" }, to: { id: "b", kind: "bank" } })) lines.push(...p.lines);
      }
      expect(trialBalance(lines).balanced).toBe(true);
    }
  });
});

describe("cash book (FN16)", () => {
  it("lists the money in and out of the treasury accounts, with what each was against", () => {
    const book = cashBookOf([
      { id: "e1", day: "2026-03-05", label: "Dépense", lines: [line("612512", 120_000n, 0n), line("5161", 0n, 120_000n)] },
      { id: "e2", day: "2026-03-02", label: "Vente", lines: [line("3421", 800_000n, 0n), line("712121", 0n, 800_000n), line("5161", 800_000n, 0n), line("3421", 0n, 800_000n)] },
      { id: "e3", day: "2026-03-01", label: "Achat", lines: [line("612122", 100n, 0n), line("4411", 0n, 100n)] }, // on credit: no money moved
    ]);
    expect(book.rows.map((r) => [r.day, r.label, r.account, r.receipt, r.expense])).toEqual([
      ["2026-03-02", "Vente", "5161", 800_000n, 0n],
      ["2026-03-05", "Dépense", "5161", 0n, 120_000n],
    ]);
    expect(book).toMatchObject({ receipts: 800_000n, expenses: 120_000n, net: 680_000n });
  });
});
