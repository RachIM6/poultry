import { db, type Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { ProtocolItem, ReferenceData } from "@/modules/reference-data/schema";

/** R4: the same for every organisation (not farm data, so no tenant context), read-only, cached by the phone. */
export async function getReferenceData(): Promise<ReferenceData> {
  const [strains, products, templates] = await Promise.all([
    db.strain.findMany({
      orderBy: { id: "asc" },
      include: { curves: { orderBy: { version: "asc" }, include: { points: { orderBy: { day: "asc" } } } } },
    }),
    db.product.findMany({ orderBy: { id: "asc" } }),
    db.protocolTemplate.findMany({ orderBy: { id: "asc" } }),
  ]);
  return {
    strains: strains.map((s) => ({
      id: s.id,
      name: s.name,
      curves: s.curves.map((c) => ({
        source: c.source,
        version: c.version,
        points: c.points.map(({ day, bodyWeightGrams, cumulativeFeedGrams }) => ({ day, bodyWeightGrams, cumulativeFeedGrams })),
      })),
    })),
    products: products.map(({ id, kind, nameFr, nameAr, withdrawalDays }) => ({ id, kind, nameFr, nameAr, withdrawalDays })),
    protocolTemplates: templates.map(({ id, nameFr, nameAr, reviewedByVet, items }) => ({
      id,
      nameFr,
      nameAr,
      reviewedByVet,
      items: items as ProtocolItem[],
    })),
  };
}

/** For other modules: is this id a product of the catalogue? Read inside their transaction. */
export const isCatalogueProduct = async (tx: Tx, id: string) => (await tx.product.count({ where: { id } })) === 1;

/** For other modules: is this a strain of the catalogue (R1)? */
export const isStrain = async (tx: Tx, id: string) => (await tx.strain.count({ where: { id } })) === 1;

/** For other modules: are these all vaccines of the catalogue (R3)? */
export async function areVaccines(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  return (await tx.product.count({ where: { id: { in: unique }, kind: "vaccine" } })) === unique.length;
}

/** For other modules: is this protocol the caller's organisation's own (R2)? */
export const ownProtocol = async (tx: Tx, ctx: TenantContext, id: string) =>
  (await tx.vaccinationProtocol.count({ where: { id, organizationId: ctx.organizationId } })) === 1;

/** For other modules: a catalogue product's names, for messages in either language. */
export const productNames = (tx: Tx, id: string) => tx.product.findUnique({ where: { id }, select: { nameFr: true, nameAr: true } });
