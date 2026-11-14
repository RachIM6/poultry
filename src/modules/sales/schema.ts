import { z } from "zod";
import { INSTRUMENT_STATES } from "@/modules/sales/domain/instruments";
import { BUYER_TYPES, PAYMENT_METHODS } from "@/modules/sales/domain/sale";
import { LATER_PAYMENT_METHODS } from "@/modules/sales/shared";

// SPEC V1–V4, the sync push's validation. The phone's screens import ./shared.ts (no Zod, ADR-009), re-exported here so
// server code and tests keep one import.
export * from "@/modules/sales/shared";

const text = (max: number) => z.string().trim().min(1).max(max);
const centimes = z.string().regex(/^\d{1,15}$/); // integer centimes; JSON has no bigint

export const CreateBuyer = z.object({
  id: z.uuid(),
  name: text(120),
  phone: z.string().trim().max(32).transform((s) => s || null).nullable(),
  type: z.enum(BUYER_TYPES),
});

export const RecordSale = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  buyerId: z.uuid(),
  day: z.iso.date(), // farm day
  birds: z.int32().positive(),
  farmWeightGrams: z.int32().positive(),
  buyerWeightGrams: z.int32().positive().nullable(),
  pricePerKgCentimes: centimes,
  paymentMethod: z.enum(PAYMENT_METHODS),
  paidCentimes: centimes,
  instrument: z.object({ number: text(40), dueOn: z.iso.date() }).nullable(), // cheque or bill of exchange
});

/** V4: a later payment from a buyer, against what they owe. */
export const RecordPayment = z.object({
  id: z.uuid(),
  buyerId: z.uuid(),
  day: z.iso.date(), // farm day
  amountCentimes: centimes,
  method: z.enum(LATER_PAYMENT_METHODS),
});

/** SPEC-finance FN11: a received cheque or bill remitted, cashed or unpaid. The id is a UUIDv7: statuses sort by it. */
export const SetInstrumentState = z.object({ id: z.uuidv7(), instrumentId: z.uuid(), state: z.enum(INSTRUMENT_STATES), day: z.iso.date() });

/** FN12: the owner lets a buyer whose cheque or bill came back unpaid buy on credit again. */
export const UnblockBuyer = z.object({ buyerId: z.uuid() });
