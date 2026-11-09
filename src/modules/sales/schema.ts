import { z } from "zod";
import { BUYER_TYPES, PAYMENT_METHODS } from "@/modules/sales/domain/sale";

// SPEC V1–V3, written offline: the phone and the sync push validate with the same schemas and run the same checks.
export { BUYER_TYPES, PAYMENT_METHODS, checkSale, saleAmount, weighingGap } from "@/modules/sales/domain/sale";
export type { PaymentMethod, SaleError } from "@/modules/sales/domain/sale";
export { buyerBalances, checkPayment } from "@/modules/sales/domain/receivables";

const text = (max: number) => z.string().trim().min(1).max(max);
const centimes = z.string().regex(/^\d{1,15}$/); // integer centimes; JSON has no bigint

export const CreateBuyer = z.object({
  id: z.uuid(),
  name: text(120),
  phone: z.string().trim().max(32).transform((s) => s || null).nullable(),
  type: z.enum(BUYER_TYPES),
});
export type BuyerDto = z.output<typeof CreateBuyer>;

export const RecordSale = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  buyerId: z.uuid(),
  day: z.iso.date(), // farm day
  birds: z.int().positive(),
  farmWeightGrams: z.int().positive(),
  buyerWeightGrams: z.int().positive().nullable(),
  pricePerKgCentimes: centimes,
  paymentMethod: z.enum(PAYMENT_METHODS),
  paidCentimes: centimes,
  instrument: z.object({ number: text(40), dueOn: z.iso.date() }).nullable(), // cheque or bill of exchange
});

/** What pull returns and the phone stores. Workers never record or receive sales (I5); the money is stripped anyway. */
export type SaleDto = Omit<z.infer<typeof RecordSale>, "pricePerKgCentimes" | "paidCentimes" | "paymentMethod" | "instrument"> & {
  pricePerKgCentimes?: string;
  amountCentimes?: string;
  paymentMethod?: z.infer<typeof RecordSale>["paymentMethod"];
  paidCentimes?: string;
  instrument?: z.infer<typeof RecordSale>["instrument"];
};
export const SALE_MONEY = ["pricePerKgCentimes", "amountCentimes", "paymentMethod", "paidCentimes", "instrument"] as const;

/** V4: a later payment from a buyer, against what they owe. */
export const RecordPayment = z.object({
  id: z.uuid(),
  buyerId: z.uuid(),
  day: z.iso.date(), // farm day
  amountCentimes: centimes,
  method: z.enum(["cash", "cheque", "bill", "transfer"]),
});
export type PaymentDto = z.infer<typeof RecordPayment>; // all money: owners and managers only (I5)

export const SALES_MUTATIONS = { createBuyer: "sales.createBuyer", recordSale: "sales.recordSale", recordPayment: "sales.recordPayment" } as const;
