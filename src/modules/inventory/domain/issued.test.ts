import { describe, expect, it } from "vitest";
import { checkDebit, issuedOf } from "@/modules/inventory/domain/issued";

describe("cheques and bills issued to suppliers (SPEC-finance FN11)", () => {
  const purchases = [
    { id: "p1", supplierId: "s", day: "2026-03-02", paidCentimes: 300_000n, paidMethod: "bill" },
    { id: "p2", supplierId: "s", day: "2026-03-02", paidCentimes: 300_000n, paidMethod: "cash" }, // not an instrument
    { id: "p3", supplierId: "s", day: "2026-03-02", paidCentimes: 0n, paidMethod: "cheque" }, // nothing paid
  ];
  const payments = [
    { id: "q1", supplierId: "s", day: "2026-03-10", amountCentimes: 500_000n, method: "cheque", instrument: { number: "0012345", dueOn: "2026-04-10" } },
    { id: "q2", supplierId: "s", day: "2026-03-11", amountCentimes: 100_000n, method: "transfer" },
  ];

  it("lists a purchase's paid part and later payments by cheque or bill, with their agreed date and debit", () => {
    expect(issuedOf(purchases, payments, [{ instrumentId: "q1", day: "2026-04-10" }])).toEqual([
      { id: "p1", supplierId: "s", kind: "bill", number: null, amountCentimes: 300_000n, issuedOn: "2026-03-02", dueOn: "2026-03-02", debitedOn: null },
      { id: "q1", supplierId: "s", kind: "cheque", number: "0012345", amountCentimes: 500_000n, issuedOn: "2026-03-10", dueOn: "2026-04-10", debitedOn: "2026-04-10" },
    ]);
  });

  it("debits once, not before the issue day", () => {
    const [bill, cheque] = issuedOf(purchases, payments, [{ instrumentId: "q1", day: "2026-04-10" }]);
    expect(checkDebit(bill, "2026-03-31")).toEqual({ ok: true, value: undefined });
    expect(checkDebit(bill, "2026-03-01")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(checkDebit(cheque, "2026-04-11")).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(checkDebit(undefined, "2026-04-11")).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
