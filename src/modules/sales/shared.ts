import type { BUYER_TYPES, PaymentMethod } from "@/modules/sales/domain/sale";

// What the phone's screens need from sales, without Zod (ADR-009): the amount, the gap, the sale and payment checks
// the phone runs like the server, the DTOs and the mutation names. The Zod schemas are in ./schema.ts, which
// re-exports this file.
export { BUYER_TYPES, PAYMENT_METHODS, checkSale, saleAmount, weighingGap } from "@/modules/sales/domain/sale";
export type { PaymentMethod, SaleError } from "@/modules/sales/domain/sale";
export { buyerBalances, checkPayment } from "@/modules/sales/domain/receivables";

/** V4: how a buyer pays later (credit is not a payment). */
export const LATER_PAYMENT_METHODS = ["cash", "cheque", "bill", "transfer"] as const;

export type BuyerDto = { id: string; name: string; phone: string | null; type: (typeof BUYER_TYPES)[number] };

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
};
export const SALE_MONEY = ["pricePerKgCentimes", "amountCentimes", "paymentMethod", "paidCentimes", "instrument"] as const;

/** V4: a later payment. All money: owners and managers only (I5). */
export type PaymentDto = { id: string; buyerId: string; day: string; amountCentimes: string; method: (typeof LATER_PAYMENT_METHODS)[number] };

export const SALES_MUTATIONS = { createBuyer: "sales.createBuyer", recordSale: "sales.recordSale", recordPayment: "sales.recordPayment" } as const;
