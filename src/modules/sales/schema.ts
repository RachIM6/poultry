import { z } from "zod";
import { INSTRUMENT_STATES } from "@/modules/sales/domain/instruments";
import { BUYER_TYPES, HEAD_KINDS, PAYMENT_METHODS } from "@/modules/sales/domain/sale";
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
  vatCentimes: centimes.default("0"), // SPEC-finance FN9: the invoice's VAT, part of the total
  instrument: z.object({ number: text(40), dueOn: z.iso.date() }).nullable(), // cheque or bill of exchange
});

/** SPEC-m3 V6: eggs of a layer batch, by item, priced per tray. */
export const RecordEggSale = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  buyerId: z.uuid(),
  day: z.iso.date(),
  lines: z
    .array(
      z.object({
        item: z.union([z.literal("ungraded"), z.literal("downgraded"), z.string().regex(/^grade:[a-z0-9]+(-[a-z0-9]+)*$/).max(26)]),
        eggs: z.int32().positive(),
        eggsPerTray: z.int32().positive().max(1000).default(30), // MQ8
        unitPriceCentimes: centimes,
      }),
    )
    .min(1)
    .max(20),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paidCentimes: centimes,
  vatCentimes: centimes.default("0"),
  instrument: z.object({ number: text(40), dueOn: z.iso.date() }).nullable(),
});

/** SPEC-m3 V7: live birds sold by the head, by line; the farm weight is optional. */
export const RecordHeadSale = z.object({
  id: z.uuid(),
  batchId: z.uuid(),
  buyerId: z.uuid(),
  day: z.iso.date(),
  lines: z.array(z.object({ item: z.enum(HEAD_KINDS), birds: z.int32().positive(), pricePerHeadCentimes: centimes })).min(1).max(3),
  farmWeightGrams: z.int32().positive().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paidCentimes: centimes,
  vatCentimes: centimes.default("0"),
  instrument: z.object({ number: text(40), dueOn: z.iso.date() }).nullable(),
});

/** V4: a later payment from a buyer, against what they owe. */
export const RecordPayment = z.object({
  id: z.uuid(),
  buyerId: z.uuid(),
  day: z.iso.date(), // farm day
  amountCentimes: centimes,
  method: z.enum(LATER_PAYMENT_METHODS),
  instrument: z.object({ number: text(40), dueOn: z.iso.date() }).nullable().default(null), // FN11: cheque or bill only
});

/** SPEC-finance FN11: a received cheque or bill remitted, cashed or unpaid. The id is a UUIDv7: statuses sort by it. */
export const SetInstrumentState = z.object({ id: z.uuidv7(), instrumentId: z.uuid(), state: z.enum(INSTRUMENT_STATES), day: z.iso.date() });

/** FN12: the owner lets a buyer whose cheque or bill came back unpaid buy on credit again. */
export const UnblockBuyer = z.object({ buyerId: z.uuid() });

/** FN12: the owner sets what a buyer may owe at most; null removes the limit. */
export const SetCreditLimit = z.object({ buyerId: z.uuid(), limitCentimes: centimes.nullable() });

/** FN12: the owner approves a credit sale that went past the buyer's limit. */
export const ApproveCredit = z.object({ saleId: z.uuid() });
