import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { placeNames } from "@/modules/farm-registry";
import { batchPlaces } from "@/modules/flock";
import { ledgerTagsOf as inventoryTags } from "@/modules/inventory";
import { ledgerTagsOf as salesTags } from "@/modules/sales";
import { ledgerTagsOf as workforceTags } from "@/modules/workforce";
import { monthPeriod } from "@/modules/finance/domain/batch";
import type { EntryTags } from "@/modules/finance/domain/export";

type Tag = { party: string | null; farmId: string | null; batchId: string | null; houseId?: string | null }; // houseId: without a batch (a fixed asset)
const dmy = (day: string) => day.split("-").reverse().join("/");
const expenseOf = (source: string) => (source.startsWith("expense:") ? source.split(":")[1] : source);

/**
 * FN18's analytic columns, read from the record each of the month's entries posts (its source), so entries posted
 * before the columns existed get them too: the supplier, buyer or employee, the farm, and a batch's house and
 * placement day. A reversal has its original's source, so its tags.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function entryTags(ctx: TenantContext, month: string): Promise<EntryTags> {
  const { from, to } = monthPeriod(month);
  const entries = await db.journalEntry.findMany({
    where: { organizationId: ctx.organizationId, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, sourceId: { not: null } },
    select: { id: true, sourceModule: true, sourceId: true },
  });
  const idsOf = (module: string) => entries.filter((e) => e.sourceModule === module).map((e) => e.sourceId!);
  const assetSources = idsOf("finance").flatMap((source) => (source.startsWith("asset:") ? [[source, source.split(":")[1]] as const] : [])); // asset:<id>:acq|pay:<id>|disposal (FC1)
  const [inventory, sales, workforce, expenses, assets] = await Promise.all([
    inventoryTags(db, ctx, idsOf("inventory")),
    salesTags(db, ctx, idsOf("sales")),
    workforceTags(db, ctx, idsOf("workforce")),
    // A finance source is a record's id (an expense, a transfer) or a rule's key (asset:<id>:acq, FC1): uuids only here.
    // A credit expense's payment (expense:<id>:pay:<id>, §9) takes its expense's batch.
    db.expense.findMany({ where: { organizationId: ctx.organizationId, id: { in: idsOf("finance").map(expenseOf).filter((id) => UUID.test(id)) } }, select: { id: true, batchId: true } }),
    db.fixedAsset.findMany({ where: { organizationId: ctx.organizationId, id: { in: assetSources.map(([, id]) => id).filter((id) => UUID.test(id)) } }, select: { id: true, farmId: true, houseId: true } }),
  ]);
  const assetOf = new Map(assets.map((a) => [a.id, a]));
  const tagOf = new Map<string, Tag>([
    ...inventory,
    ...sales,
    ...workforce,
    ...expenses.map((x) => [x.id, { party: null, farmId: null, batchId: x.batchId }] as const),
    ...idsOf("finance").flatMap((source) => {
      const x = source.startsWith("expense:") && expenses.find((e) => e.id === expenseOf(source));
      return x ? [[source, { party: null, farmId: null, batchId: x.batchId }] as const] : [];
    }),
    ...idsOf("flock").map((id) => [id, { party: null, farmId: null, batchId: id }] as const), // the chicks of a placement
    ...idsOf("finance").flatMap((source) => (source.startsWith("placement:") ? [[source, { party: null, farmId: null, batchId: source.split(":")[1] }] as const] : [])), // their payment (§9)
    ...assetSources.flatMap(([source, id]) => {
      const a = assetOf.get(id);
      return a ? [[source, { party: null, farmId: a.farmId, batchId: null, houseId: a.houseId }] as const] : [];
    }),
  ]);
  const batches = await batchPlaces(db, ctx, [...tagOf.values()].flatMap((t) => (t.batchId ? [t.batchId] : [])));
  const names = await placeNames(db, ctx, [...[...tagOf.values()].flatMap((t) => [t.farmId, t.houseId].filter((id) => id != null)), ...[...batches.values()].flatMap((b) => [b.farmId, b.houseId])]);
  const tags = new Map<string, [string, string, string, string]>();
  for (const e of entries) {
    const t = tagOf.get(e.sourceId!);
    if (!t) continue;
    const batch = t.batchId ? batches.get(t.batchId) : undefined;
    const farmId = batch?.farmId ?? t.farmId;
    tags.set(e.id, [t.party ?? "", (farmId && names.get(farmId)) ?? "", names.get(batch?.houseId ?? t.houseId ?? "") ?? "", batch ? dmy(batch.placedOn) : ""]);
  }
  return tags;
}
