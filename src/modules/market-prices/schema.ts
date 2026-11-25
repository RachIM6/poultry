import { z } from "zod";
import { PRODUCTS } from "@/modules/market-prices/shared";

// SPEC-m5 §6, the sync push's validation. The phone's screens import ./shared.ts (no Zod, ADR-009).
export * from "@/modules/market-prices/shared";

// MP1: integer centimes per unit, more than zero; what (and where) it was seen on, optional.
export const RecordPrice = z.object({
  id: z.uuid(),
  product: z.enum(PRODUCTS),
  day: z.iso.date(),
  priceCentimes: z.string().regex(/^[1-9]\d{0,9}$/),
  seenOn: z.string().trim().max(200).transform((s) => s || null).nullable(),
});
