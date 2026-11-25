import { db, type Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { BirdSex, ProductionType, ProtocolItem, ReferenceData, Strain } from "@/modules/reference-data/schema";

/** R4: the same for every organisation (not farm data, so no tenant context), read-only, cached by the phone. */
export async function getReferenceData(): Promise<ReferenceData> {
  const [strains, products, templates, eggGrades] = await Promise.all([
    db.strain.findMany({
      orderBy: { id: "asc" },
      include: {
        curves: { orderBy: { version: "asc" }, include: { points: { orderBy: { day: "asc" } } } },
        layingCurves: { orderBy: { version: "asc" }, include: { points: { orderBy: { week: "asc" } } } },
      },
    }),
    db.product.findMany({ orderBy: { id: "asc" } }),
    db.protocolTemplate.findMany({ orderBy: { id: "asc" } }),
    db.eggGrade.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return {
    strains: strains.map((s) => ({
      id: s.id,
      name: s.name,
      productionTypes: s.productionTypes as Strain["productionTypes"],
      curves: s.curves.map((c) => ({
        source: c.source,
        version: c.version,
        sex: c.sex as BirdSex,
        points: c.points.map(({ day, bodyWeightGrams, cumulativeFeedGrams }) => ({ day, bodyWeightGrams, cumulativeFeedGrams })),
      })),
      layingCurves: s.layingCurves.map((c) => ({
        source: c.source,
        version: c.version,
        points: c.points.map(({ week, layingRatePermille, eggsPerHenHousedTenths, eggWeightDg, feedGramsPerHenDay, bodyWeightGrams }) => ({
          week,
          layingRatePermille,
          eggsPerHenHousedTenths,
          eggWeightDg,
          feedGramsPerHenDay,
          bodyWeightGrams,
        })),
      })),
    })),
    products: products.map(({ id, kind, nameFr, nameAr, withdrawalDays, eggWithdrawalDays }) => ({ id, kind, nameFr, nameAr, withdrawalDays, eggWithdrawalDays })),
    protocolTemplates: templates.map(({ id, nameFr, nameAr, reviewedByVet, productionType, items }) => ({
      id,
      nameFr,
      nameAr,
      reviewedByVet,
      productionType: productionType as ProductionType,
      items: items as ProtocolItem[],
    })),
    eggGrades: eggGrades.map(({ id, label, sortOrder, minGrams, maxGrams }) => ({ id, label, sortOrder, minGrams, maxGrams })),
  };
}

/** For other modules: is this id a product of the catalogue? Read inside their transaction. */
export const isCatalogueProduct = async (tx: Tx, id: string) => (await tx.product.count({ where: { id } })) === 1;

/** For other modules: is this a strain of the catalogue that serves this production type (R1, R5)? */
export const strainServes = async (tx: Tx, id: string, type: ProductionType) =>
  (await tx.strain.count({ where: { id, productionTypes: { has: type } } })) === 1;

/** For other modules: are these all vaccines of the catalogue (R3)? */
export async function areVaccines(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  return (await tx.product.count({ where: { id: { in: unique }, kind: "vaccine" } })) === unique.length;
}

/** For eggs (SPEC-m3 E3): are these all grade classes of the reference data (S, M, L, XL…)? */
export async function areEggGrades(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  return (await tx.eggGrade.count({ where: { id: { in: unique } } })) === unique.length;
}

/** For other modules: is this protocol the caller's organisation's own (R2)? */
export const ownProtocol = async (tx: Tx, ctx: TenantContext, id: string) =>
  (await tx.vaccinationProtocol.count({ where: { id, organizationId: ctx.organizationId } })) === 1;

/** For other modules: a catalogue product's names, for messages in either language. */
export const productNames = (tx: Tx, id: string) => tx.product.findUnique({ where: { id }, select: { nameFr: true, nameAr: true } });
