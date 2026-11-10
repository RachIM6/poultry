import { z } from "zod";

// SPEC R1–R4. Isomorphic, and also imported by prisma/seed.ts under plain Node: no "@/" imports here.

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);
const text = (max: number) => z.string().trim().min(1).max(max);

export const CurvePoint = z.object({
  day: z.int().min(0).max(120), // age in days, as-hatched
  bodyWeightGrams: z.int().min(1),
  cumulativeFeedGrams: z.int().min(0),
});
export type CurvePoint = z.infer<typeof CurvePoint>;

/** prisma/seed/reference/curves/<strain>-<version>.json: one breeder table, exactly as published (OQ5). */
export const CurveFile = z.object({
  strainId: slug,
  source: text(200), // document title and publisher
  version: text(40),
  points: z
    .array(CurvePoint)
    .min(2)
    .refine((ps) => ps.every((p, i) => i === 0 || p.day > ps[i - 1].day), "days must increase"),
});
export type CurveFile = z.infer<typeof CurveFile>;

/**
 * The strain standard at an age (R1). Published tables may skip days: between two of them the value is linear,
 * rounded to the gram. Null outside the table: a standard is never extrapolated.
 */
export function standardAt(points: readonly CurvePoint[], day: number) {
  const next = points.findIndex((p) => p.day >= day);
  if (next === -1 || (next === 0 && points[0].day !== day)) return null;
  const hi = points[next];
  if (hi.day === day) return { bodyWeightGrams: hi.bodyWeightGrams, cumulativeFeedGrams: hi.cumulativeFeedGrams };
  const lo = points[next - 1];
  const t = (day - lo.day) / (hi.day - lo.day);
  const at = (a: number, b: number) => Math.round(a + (b - a) * t);
  return { bodyWeightGrams: at(lo.bodyWeightGrams, hi.bodyWeightGrams), cumulativeFeedGrams: at(lo.cumulativeFeedGrams, hi.cumulativeFeedGrams) };
}

export const Strain = z.object({ id: slug, name: text(80) });
export type Strain = z.infer<typeof Strain>;

export const PRODUCT_KINDS = ["feed", "vaccine", "medicine"] as const;
export const Product = z.object({
  id: slug,
  kind: z.enum(PRODUCT_KINDS),
  nameFr: text(120),
  nameAr: text(120),
  withdrawalDays: z.int().min(0).max(365).nullable(), // meat withdrawal (R3); null = not known yet
});
export type Product = z.infer<typeof Product>;

export const VACCINATION_METHODS = ["drinkingWater", "spray", "eyeDrop", "injection"] as const;
export const ProtocolItem = z.object({
  dayOfAge: z.int().min(0).max(120),
  productId: slug, // a vaccine of the catalogue
  method: z.enum(VACCINATION_METHODS),
});
export type ProtocolItem = z.infer<typeof ProtocolItem>;
const ProtocolItems = z.array(ProtocolItem).max(50);

export const ProtocolTemplate = z.object({
  id: slug,
  nameFr: text(120),
  nameAr: text(120),
  reviewedByVet: z.boolean(), // OQ4
  items: ProtocolItems,
});
export type ProtocolTemplate = z.infer<typeof ProtocolTemplate>;

/** GET /api/reference: everything the phone keeps offline (R4). */
export type ReferenceData = {
  strains: (Strain & { curves: Omit<CurveFile, "strainId">[] })[];
  products: Product[];
  protocolTemplates: ProtocolTemplate[];
};

// An organisation's own protocol, copied from a template and edited offline (R2). The template never changes.
export const CopyProtocol = z.object({ id: z.uuid(), templateId: slug, name: text(80) });
export const UpdateProtocol = z.object({
  id: z.uuid(),
  changes: z
    .object({ name: text(80), items: ProtocolItems })
    .partial()
    .refine((c) => Object.keys(c).length > 0, "no change"),
});
export type ProtocolDto = { id: string; templateId: string | null; name: string; items: ProtocolItem[] };

export const REFERENCE_MUTATIONS = {
  copyProtocol: "reference-data.copyProtocol",
  updateProtocol: "reference-data.updateProtocol",
} as const;
