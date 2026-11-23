import { z } from "zod";
import { ITEM_KINDS, UNITS } from "@/modules/inventory/domain/stock";
import { SUPPLIER_PAYMENT_METHODS } from "@/modules/inventory/shared";

// SPEC S1–S3, written offline: the phone and the sync push validate with these same schemas (ADR-003). Screens that
// don't validate import ./shared.ts (no Zod, ADR-009), re-exported here.
export * from "@/modules/inventory/shared";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable();
const day = z.iso.date(); // a farm day
const centimes = z.string().regex(/^\d{1,15}$/); // integer centimes; JSON has no bigint

export const CreateSupplier = z.object({ id: z.uuid(), name: text(120), phone: optionalText(32) });
export const CreateStockItem = z.object({
  id: z.uuid(),
  farmId: z.uuid(),
  productId: z.string().max(60).nullable(), // reference-data catalogue, when it is one of its products
  kind: z.enum(ITEM_KINDS),
  name: text(120),
  unit: z.enum(UNITS),
  lot: optionalText(60),
  expiresOn: day.nullable(),
  lowStockThreshold: z.int32().positive().nullable().default(null), // S6: base units; no alert when unset
});
export const SetThreshold = z.object({ stockItemId: z.uuid(), lowStockThreshold: z.int32().positive().nullable() });
// The purchase and its stock movement are created together; both ids come from the device. A phone's movement id is a
// UUIDv7, never a UUIDv5 another organisation can compute ahead (the movement of a daily entry or a vaccination).
export const RecordPurchase = z.object({
  id: z.uuid(),
  movementId: z.uuidv7(),
  supplierId: z.uuid(),
  stockItemId: z.uuid(),
  day,
  quantity: z.int32().positive(), // base units (grams for kg)
  unitPriceCentimes: centimes, // per displayed unit
  paidCentimes: centimes,
  vatCentimes: centimes.default("0"), // SPEC-finance FN9: the invoice's VAT, part of the total
  paidMethod: z.enum(SUPPLIER_PAYMENT_METHODS).default("cash"), // FN6; older queued writes without it were paid in cash
  dueOn: day.nullable(),
});
export const RecordSupplierPayment = z.object({
  id: z.uuid(),
  supplierId: z.uuid(),
  day,
  amountCentimes: centimes,
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  instrument: z.object({ number: optionalText(40), dueOn: day }).nullable().default(null), // FN11: cheque or bill only
});
export const DebitIssued = z.object({ id: z.uuidv7(), instrumentId: z.uuid(), day }); // FN11: issued → debited
export const AdjustStock = z.object({
  id: z.uuidv7(), // the movement's, as in RecordPurchase
  stockItemId: z.uuid(),
  day,
  quantity: z.int32().refine((q) => q !== 0), // signed: + found, − lost
  reason: text(200),
});
