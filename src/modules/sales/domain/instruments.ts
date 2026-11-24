import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-finance FN11. Pure: the phone shows the portfolio and checks a change of state with the same code as the server.

/** What can happen to a cheque or bill received: remitted to the bank, then cashed or unpaid (or straight away). */
export const INSTRUMENT_STATES = ["remitted", "cashed", "unpaid"] as const;
export type InstrumentState = "in_portfolio" | (typeof INSTRUMENT_STATES)[number];
export type InstrumentKind = "cheque" | "bill";

/** A cheque or bill received for a sale (paid at once) or a later payment; its id is that sale's or payment's. */
export type Instrument = {
  id: string;
  buyerId: string;
  kind: InstrumentKind;
  number: string | null; // a later payment's, when given
  amountCentimes: bigint;
  dueOn: string; // farm day: the agreed date (a post-dated cheque stays payable on sight, FN11)
  state: InstrumentState;
};

type SaleRow = { id: string; buyerId: string | null; paymentMethod: string; paidCentimes: bigint; instrument: { number: string; dueOn: string } | null; day: string };
type PaymentRow = { id: string; buyerId: string; method: string; amountCentimes: bigint; day: string; instrument?: { number: string; dueOn: string } | null };
type StatusRow = { instrumentId: string; state: (typeof INSTRUMENT_STATES)[number]; id: string }; // ids are UUIDv7: later = newer

const isInstrument = (method: string): method is InstrumentKind => method === "cheque" || method === "bill";

/** Every cheque and bill received, with its current state (its latest status, by status id). */
export function instrumentsOf(sales: readonly SaleRow[], payments: readonly PaymentRow[], statuses: readonly StatusRow[]): Instrument[] {
  const latest = new Map<string, StatusRow>();
  for (const s of statuses) if ((latest.get(s.instrumentId)?.id ?? "") < s.id) latest.set(s.instrumentId, s);
  const stateOf = (id: string): InstrumentState => latest.get(id)?.state ?? "in_portfolio";
  return [
    ...sales
      .filter((s): s is SaleRow & { buyerId: string } => s.buyerId !== null && isInstrument(s.paymentMethod) && s.paidCentimes > 0n) // a consumption: none
      .map((s) => ({ id: s.id, buyerId: s.buyerId, kind: s.paymentMethod as InstrumentKind, number: s.instrument?.number ?? null, amountCentimes: s.paidCentimes, dueOn: s.instrument?.dueOn ?? s.day, state: stateOf(s.id) })),
    ...payments
      .filter((p) => isInstrument(p.method))
      .map((p) => ({ id: p.id, buyerId: p.buyerId, kind: p.method as InstrumentKind, number: p.instrument?.number ?? null, amountCentimes: p.amountCentimes, dueOn: p.instrument?.dueOn ?? p.day, state: stateOf(p.id) })),
  ];
}

const NEXT: Record<InstrumentState, readonly InstrumentState[]> = {
  in_portfolio: ["remitted", "cashed", "unpaid"],
  remitted: ["cashed", "unpaid"],
  cashed: [],
  unpaid: [], // a new cheque from the buyer is a new payment
};

/** FN11: a received cheque or bill only moves forward. */
export function checkTransition(from: InstrumentState, to: InstrumentState): Result<void, "INVALID_TRANSITION"> {
  return NEXT[from].includes(to) ? ok(undefined) : fail("INVALID_TRANSITION");
}
