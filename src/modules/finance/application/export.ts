import { db } from "@/lib/db";
import { ok, type Result } from "@/lib/kernel/result";
import { toCsv } from "@/lib/kernel/sheet";
import type { TenantContext } from "@/lib/tenant";
import { toXlsx } from "@/lib/xlsx";
import { zip } from "@/lib/zip";
import { readFile } from "@/modules/documents";
import { placeNames } from "@/modules/farm-registry";
import { batchPlaces } from "@/modules/flock";
import { ledgerTagsOf as inventoryTags } from "@/modules/inventory";
import { ledgerTagsOf as salesTags } from "@/modules/sales";
import { ledgerTagsOf as workforceTags } from "@/modules/workforce";
import { readBooks } from "@/modules/finance/application/books";
import { monthPeriod } from "@/modules/finance/domain/batch";
import { exportSheets, receiptName, type EntryTags } from "@/modules/finance/domain/export";

/**
 * FN18: a month of books for the accountant, as one .zip: one CSV per sheet, the same sheets in one .xlsx, and the
 * month's expense receipts in `pieces/`, each named after its entry's day and id (the "Pièce" column).
 * Owners and managers only, like /books.
 */
export async function exportBooks(ctx: TenantContext, month: string): Promise<Result<{ file: string; zip: Buffer }, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  const books = await readBooks(ctx, month);
  if (!books.ok) return books;
  const sheets = exportSheets(books.value, books.value.journals ? await entryTags(ctx, month) : undefined);
  return ok({
    file: `comptabilite-${month}.zip`,
    zip: zip([...sheets.map((s) => ({ name: `${s.file}-${month}.csv`, data: toCsv(s) })), { name: `livres-${month}.xlsx`, data: toXlsx(sheets) }, ...(await receipts(ctx, month))]),
  });
}

/** The receipts of the expenses whose entry falls in the month (an expense of a locked month is posted in the next open one). */
async function receipts(ctx: TenantContext, month: string) {
  const org = { organizationId: ctx.organizationId };
  // shortcut: reads every receipted expense id of the organisation, then keeps the month's entries; filter by day once
  // a farm has thousands (a locked month moves the entry, so the expense's own day isn't enough).
  const expenses =await db.expense.findMany({ where: { ...org, receiptFileId: { not: null } }, select: { id: true, receiptFileId: true } });
  if (expenses.length === 0) return [];
  const [y, m] = month.split("-").map(Number);
  const entries = await db.journalEntry.findMany({
    where: { ...org, sourceModule: "finance", sourceId: { in: expenses.map((e) => e.id) }, reversesId: null, day: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } },
    select: { id: true, day: true, sourceId: true },
  });
  const fileOf = new Map(expenses.map((e) => [e.id, e.receiptFileId!]));
  const files = [];
  for (const e of entries) {
    const file = await readFile(ctx, fileOf.get(e.sourceId!)!);
    if (file.ok) files.push({ name: receiptName(e.day.toISOString().slice(0, 10), e.id, file.value.contentType), data: file.value.bytes });
  }
  return files;
}

type Tag = { party: string | null; farmId: string | null; batchId: string | null };
const dmy = (day: string) => day.split("-").reverse().join("/");

/**
 * FN18's analytic columns, read from the record each of the month's entries posts (its source), so entries posted
 * before the columns existed get them too: the supplier, buyer or employee, the farm, and a batch's house and
 * placement day. A reversal has its original's source, so its tags.
 */
async function entryTags(ctx: TenantContext, month: string): Promise<EntryTags> {
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
