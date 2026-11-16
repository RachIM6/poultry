import type { BUYER_TYPES, PaymentMethod } from "@/modules/sales/domain/sale";

// What the phone's screens need from sales, without Zod (ADR-009): the amount, the gap, the sale and payment checks
// the phone runs like the server, the DTOs and the mutation names. The Zod schemas are in ./schema.ts, which
// re-exports this file.
export { BUYER_TYPES, PAYMENT_METHODS, checkSale, saleAmount, weighingGap } from "@/modules/sales/domain/sale";
export type { PaymentMethod, SaleError } from "@/modules/sales/domain/sale";
export { AGEING_BUCKETS, ageing, ageingBucket, buyerBalances, checkPayment } from "@/modules/sales/domain/receivables";
export type { AgeingBucket } from "@/modules/sales/domain/receivables";
export { INSTRUMENT_STATES, checkTransition, instrumentsOf } from "@/modules/sales/domain/instruments";
export type { Instrument, InstrumentKind, InstrumentState } from "@/modules/sales/domain/instruments";

/** V4: how a buyer pays later (credit is not a payment). */
export const LATER_PAYMENT_METHODS = ["cash", "cheque", "bill", "transfer"] as const;

/** `creditBlocked`: one of their cheques or bills came back unpaid; no sale on credit until the owner lifts it (FN12). */
export type BuyerDto = {
  id: string;
  name: string;
  phone: string | null;
  type: (typeof BUYER_TYPES)[number];
  creditBlocked?: boolean;
  creditLimitCentimes?: string | null; // FN12, money: owners and managers only
};

/** FN11: one step of a received cheque or bill. Its id is a UUIDv7 from the phone, so ids sort by time. */
export type InstrumentStatusDto = { id: string; instrumentId: string; state: "remitted" | "cashed" | "unpaid"; day: string };

/** V5: the origin document's number, from the sale's id (also the id of the birds it took out). */
export const originNumber = (saleId: string) => saleId.slice(0, 8).toUpperCase();

/** What pull returns and the phone stores. Workers never record or receive sales (I5); the money is stripped anyway. */
export type SaleDto = {
  id: string;
  batchId: string;
  buyerId: string;
  day: string; // farm day
  birds: number;
  farmWeightGrams: number;
  buyerWeightGrams: number | null;
  pricePerKgCentimes?: string;
  amountCentimes?: string;
  paymentMethod?: PaymentMethod;
  paidCentimes?: string;
  instrument?: { number: string; dueOn: string } | null; // cheque or bill of exchange
  creditApproval?: "pending" | "approved" | null; // FN12: beyond the buyer's credit limit, waits for the owner
};
export const SALE_MONEY = ["pricePerKgCentimes", "amountCentimes", "paymentMethod", "paidCentimes", "instrument", "creditApproval"] as const;

/** V4: a later payment. All money: owners and managers only (I5). */
export type PaymentDto = { id: string; buyerId: string; day: string; amountCentimes: string; method: (typeof LATER_PAYMENT_METHODS)[number] };

export const SALES_MUTATIONS = {
  createBuyer: "sales.createBuyer",
  recordSale: "sales.recordSale",
  recordPayment: "sales.recordPayment",
  setInstrumentState: "sales.setInstrumentState",
  unblockBuyer: "sales.unblockBuyer",
  setCreditLimit: "sales.setCreditLimit",
  approveCredit: "sales.approveCredit",
} as const;
