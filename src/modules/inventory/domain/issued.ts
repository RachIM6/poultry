import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-finance FN11, issued side: a cheque or bill given to a supplier, `issued` until the bank debits it. Pure: the
// phone lists them and checks a debit with the same code as the server.

export type IssuedKind = "cheque" | "bill";

/** A cheque or bill issued to a supplier; its id is the purchase's (paid at once) or the later payment's. */
export type Issued = {
  id: string;
  supplierId: string;
  kind: IssuedKind;
  number: string | null; // a purchase's paid part records none
  amountCentimes: bigint;
  issuedOn: string; // farm day
  dueOn: string; // the agreed date; a purchase's: its day
  debitedOn: string | null;
};

type PurchaseRow = { id: string; supplierId: string; day: string; paidCentimes: bigint; paidMethod?: string | null };
type PaymentRow = { id: string; supplierId: string; day: string; amountCentimes: bigint; method: string; instrument?: { number: string | null; dueOn: string } | null };
type DebitRow = { instrumentId: string; day: string };

const isIssued = (method: string | null | undefined): method is IssuedKind => method === "cheque" || method === "bill";

/** Every cheque and bill issued to suppliers, debited or not. */
export function issuedOf(purchases: readonly PurchaseRow[], payments: readonly PaymentRow[], debits: readonly DebitRow[]): Issued[] {
  const debitedOn = new Map(debits.map((d) => [d.instrumentId, d.day]));
  return [
    ...purchases
      .filter((p) => isIssued(p.paidMethod) && p.paidCentimes > 0n)
      .map((p) => ({ id: p.id, supplierId: p.supplierId, kind: p.paidMethod as IssuedKind, number: null, amountCentimes: p.paidCentimes, issuedOn: p.day, dueOn: p.day, debitedOn: debitedOn.get(p.id) ?? null })),
    ...payments
      .filter((p) => isIssued(p.method))
      .map((p) => ({ id: p.id, supplierId: p.supplierId, kind: p.method as IssuedKind, number: p.instrument?.number ?? null, amountCentimes: p.amountCentimes, issuedOn: p.day, dueOn: p.instrument?.dueOn ?? p.day, debitedOn: debitedOn.get(p.id) ?? null })),
  ];
}

/** FN11: `issued → debited`, once, on or after its issue day. */
export function checkDebit(issued: Issued | undefined, day: string): Result<void, "NOT_FOUND" | "INVALID_TRANSITION" | "INVALID_INPUT"> {
  if (!issued) return fail("NOT_FOUND");
  if (issued.debitedOn) return fail("INVALID_TRANSITION");
  if (day < issued.issuedOn) return fail("INVALID_INPUT");
  return ok(undefined);
}
