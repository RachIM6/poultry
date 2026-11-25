import type { BUYER_TYPES, PaymentMethod } from "@/modules/sales/domain/sale";

// What the phone's screens need from sales, without Zod (ADR-009): the amount, the gap, the sale and payment checks
// the phone runs like the server, the DTOs and the mutation names. The Zod schemas are in ./schema.ts, which
// re-exports this file.
export { BUYER_TYPES, HEAD_KINDS, PAYMENT_METHODS, checkEggSale, checkHeadSale, checkSale, eggLineAmount, saleAmount, weighingGap } from "@/modules/sales/domain/sale";
export type { PaymentMethod, SaleError } from "@/modules/sales/domain/sale";
export { AGEING_BUCKETS, ageing, ageingBucket, buyerBalances, checkPayment } from "@/modules/sales/domain/receivables";
export type { AgeingBucket } from "@/modules/sales/domain/receivables";
export { INSTRUMENT_STATES, checkTransition, instrumentsOf } from "@/modules/sales/domain/instruments";
export type { Instrument, InstrumentKind, InstrumentState } from "@/modules/sales/domain/instruments";
export { TAKERS, lastPrices, typedPrice } from "@/modules/sales/domain/consumption";
export { repriceSale } from "@/modules/sales/domain/correction";
export type { Taker } from "@/modules/sales/domain/consumption";
import type { Taker } from "@/modules/sales/domain/consumption";

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
  address?: string | null; // the register (arrêté 2126-05 art. 4); absent from a buyer pulled before it
};

/** FN11: one step of a received cheque or bill. Its id is a UUIDv7 from the phone, so ids sort by time. */
export type InstrumentStatusDto = { id: string; instrumentId: string; state: "remitted" | "cashed" | "unpaid"; day: string };

/** V5: the origin document's number, from the sale's id (also the id of the birds it took out). */
export const originNumber = (saleId: string) => saleId.slice(0, 8).toUpperCase();

/**
 * What pull returns and the phone stores. Workers never record sales (I5) and receive them without money. A home
 * consumption (SPEC-finance FC7) is a sale with `takenBy`, no buyer and no payment (method "none"); workers record
 * those, quantities only.
 */
export type SaleDto = {
  id: string;
  batchId: string;
  buyerId: string | null; // null: a home consumption
  day: string; // farm day
  birds: number;
  farmWeightGrams: number;
  buyerWeightGrams: number | null;
  pricePerKgCentimes?: string;
  amountCentimes?: string;
  paymentMethod?: PaymentMethod | "none";
  paidCentimes?: string;
  vatCentimes?: string; // SPEC-finance FN9: part of amountCentimes; absent from a sale recorded before T39
  instrument?: { number: string; dueOn: string } | null; // cheque or bill of exchange
  creditApproval?: "pending" | "approved" | null; // FN12: beyond the buyer's credit limit, waits for the owner
  kind?: "live" | "eggs" | "perHead"; // SPEC-m3 V6, V7; absent = live
  lines?: SaleLineDto[]; // an egg sale's
  takenBy?: Taker | null; // FC7: who took the birds or eggs home; absent or null = a sale
  // The register (arrêté 2126-05 art. 4): where live birds went when not to the buyer; absent before it, null for eggs
  destination?: { name: string; address: string | null } | null;
};
/** SPEC-m3 V6, V7: a line of an egg sale, or of a per-head sale (then `eggs` counts birds and `eggsPerTray` is 1).
 * Money in centimes, as strings. */
export type SaleLineDto = { item: string; eggs: number; eggsPerTray: number; unitPriceCentimes: string; amountCentimes: string };
export const SALE_MONEY = ["pricePerKgCentimes", "amountCentimes", "paymentMethod", "paidCentimes", "vatCentimes", "instrument", "creditApproval", "lines"] as const;

/** V4: a later payment. All money: owners and managers only (I5). */
export type PaymentDto = {
  id: string;
  buyerId: string;
  day: string;
  amountCentimes: string;
  method: (typeof LATER_PAYMENT_METHODS)[number];
  instrument?: { number: string; dueOn: string } | null; // FN11: a cheque's or bill's, when given
};

export const SALES_MUTATIONS = {
  createBuyer: "sales.createBuyer",
  setBuyerAddress: "sales.setBuyerAddress",
  recordSale: "sales.recordSale",
  recordEggSale: "sales.recordEggSale",
  recordHeadSale: "sales.recordHeadSale",
  recordConsumption: "sales.recordConsumption",
  recordPayment: "sales.recordPayment",
  setInstrumentState: "sales.setInstrumentState",
  unblockBuyer: "sales.unblockBuyer",
  setCreditLimit: "sales.setCreditLimit",
  approveCredit: "sales.approveCredit",
  cancelSale: "sales.cancelSale",
  correctSale: "sales.correctSale",
} as const;
