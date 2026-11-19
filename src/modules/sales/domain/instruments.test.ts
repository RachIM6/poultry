import { describe, expect, it } from "vitest";
import { checkTransition, instrumentsOf } from "@/modules/sales/domain/instruments";
import { buyerBalances } from "@/modules/sales/domain/receivables";

const sale = (id: string, paymentMethod: string, paid: bigint, instrument: { number: string; dueOn: string } | null = null) =>
  ({ id, buyerId: "b", paymentMethod, paidCentimes: paid, instrument, day: "2026-03-01" });

describe("cheques and bills received (SPEC-finance FN11)", () => {
  it("lists every cheque and bill received, from sales and later payments, with its latest state", () => {
    const list = instrumentsOf(
      [sale("s1", "cheque", 500_000n, { number: "CHQ-1", dueOn: "2026-04-01" }), sale("s2", "cash", 100n), sale("s3", "bill", 0n), sale("s4", "bill", 300_000n, { number: "LC-9", dueOn: "2026-05-01" })],
      [{ id: "p1", buyerId: "b", method: "cheque", amountCentimes: 200_000n, day: "2026-03-10" }, { id: "p2", buyerId: "b", method: "cash", amountCentimes: 1n, day: "2026-03-10" }],
      [{ instrumentId: "s4", state: "remitted", id: "01a" }, { instrumentId: "s4", state: "cashed", id: "01b" }],
    );
    expect(list.map((i) => [i.id, i.kind, i.number, i.amountCentimes, i.dueOn, i.state])).toEqual([
      ["s1", "cheque", "CHQ-1", 500_000n, "2026-04-01", "in_portfolio"],
      ["s4", "bill", "LC-9", 300_000n, "2026-05-01", "cashed"],
      ["p1", "cheque", null, 200_000n, "2026-03-10", "in_portfolio"],
    ]);
  });

  it("only moves forward: portfolio → remitted → cashed or unpaid", () => {
    expect(checkTransition("in_portfolio", "remitted").ok).toBe(true);
    expect(checkTransition("in_portfolio", "cashed").ok).toBe(true);
    expect(checkTransition("remitted", "unpaid").ok).toBe(true);
    expect(checkTransition("remitted", "remitted")).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(checkTransition("cashed", "unpaid")).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(checkTransition("unpaid", "cashed")).toEqual({ ok: false, error: "INVALID_TRANSITION" });
  });

  it("puts an unpaid instrument back on what the buyer owes", () => {
    const sales = [{ buyerId: "b", amountCentimes: 800_000n, paidCentimes: 500_000n }];
    expect(buyerBalances(sales, []).get("b")).toBe(300_000n);
    expect(buyerBalances(sales, [], [{ buyerId: "b", amountCentimes: 500_000n }]).get("b")).toBe(800_000n);
  });
});
