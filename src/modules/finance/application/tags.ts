import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { placeNames } from "@/modules/farm-registry";
import { batchPlaces } from "@/modules/flock";
import { ledgerTagsOf as inventoryTags } from "@/modules/inventory";
import { ledgerTagsOf as salesTags } from "@/modules/sales";
import { ledgerTagsOf as workforceTags } from "@/modules/workforce";
import { monthPeriod } from "@/modules/finance/domain/batch";
import type { EntryTags } from "@/modules/finance/domain/export";

type Tag = { party: string | null; farmId: string | null; batchId: string | null };
const dmy = (day: string) => day.split("-").reverse().join("/");

/**
 * FN18's analytic columns, read from the record each of the month's entries posts (its source), so entries posted
 * before the columns existed get them too: the supplier, buyer or employee, the farm, and a batch's house and
 * placement day. A reversal has its original's source, so its tags.
 */
export async function entryTags(ctx: TenantContext, month: string): Promise<EntryTags> {
  const { from, to } = monthPeriod(month);
  const entries = await db.journalEntry.findMany({
    where: { organizationId: ctx.organizationId, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, sourceId: { not: null } },
    select: { id: true, sourceModule: true, sourceId: true },
  });
  const idsOf = (module: string) => entries.filter((e) => e.sourceModule === module).map((e) => e.sourceId!);
  const [inventory, sales, workforce, expenses] = await Promise.all([
    inventoryTags(db, ctx, idsOf("inventory")),
    salesTags(db, ctx, idsOf("sales")),
    workforceTags(db, ctx, idsOf("workforce")),
    db.expense.findMany({ where: { organizationId: ctx.organizationId, id: { in: idsOf("finance") } }, select: { id: true, batchId: true } }),
  ]);
  const tagOf = new Map<string, Tag>([
    ...inventory,
    ...sales,
    ...workforce,
    ...expenses.map((x) => [x.id, { party: null, farmId: null, batchId: x.batchId }] as const),
    ...idsOf("flock").map((id) => [id, { party: null, farmId: null, batchId: id }] as const), // the chicks of a placement
  ]);
  const batches = await batchPlaces(db, ctx, [...tagOf.values()].flatMap((t) => (t.batchId ? [t.batchId] : [])));
  const names = await placeNames(db, ctx, [...[...tagOf.values()].flatMap((t) => (t.farmId ? [t.farmId] : [])), ...[...batches.values()].flatMap((b) => [b.farmId, b.houseId])]);
  const tags = new Map<string, [string, string, string, string]>();
  for (const e of entries) {
    const t = tagOf.get(e.sourceId!);
    if (!t) continue;
    const batch = t.batchId ? batches.get(t.batchId) : undefined;
    const farmId = batch?.farmId ?? t.farmId;
    tags.set(e.id, [t.party ?? "", (farmId && names.get(farmId)) ?? "", (batch && names.get(batch.houseId)) ?? "", batch ? dmy(batch.placedOn) : ""]);
  }
  return tags;
}
