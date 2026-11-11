import { z } from "zod";
import { ITEM_KINDS, UNITS } from "@/modules/inventory/domain/stock";

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
  lowStockThreshold: z.int().positive().nullable().default(null), // S6: base units; no alert when unset
});
export const SetThreshold = z.object({ stockItemId: z.uuid(), lowStockThreshold: z.int().positive().nullable() });
// The purchase and its stock movement are created together; both ids come from the device.
export const RecordPurchase = z.object({
  id: z.uuid(),
  movementId: z.uuid(),
  supplierId: z.uuid(),
  stockItemId: z.uuid(),
  day,
  quantity: z.int().positive(), // base units (grams for kg)
  unitPriceCentimes: centimes, // per displayed unit
  paidCentimes: centimes,
  dueOn: day.nullable(),
});
export const AdjustStock = z.object({
  id: z.uuid(),
  stockItemId: z.uuid(),
  day,
  quantity: z.int().refine((q) => q !== 0), // signed: + found, − lost
  reason: text(200),
});
