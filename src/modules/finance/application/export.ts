import { db } from "@/lib/db";
import { ok, type Result } from "@/lib/kernel/result";
import { toCsv } from "@/lib/kernel/sheet";
import type { TenantContext } from "@/lib/tenant";
import { toXlsx } from "@/lib/xlsx";
import { zip } from "@/lib/zip";
import { readFile } from "@/modules/documents";
import { readBooks } from "@/modules/finance/application/books";
import { exportSheets, receiptName } from "@/modules/finance/domain/export";

/**
 * FN18: a month of books for the accountant, as one .zip: one CSV per sheet, the same sheets in one .xlsx, and the
 * month's expense receipts in `pieces/`, each named after its entry's day and id (the "Pièce" column).
 * Owners and managers only, like /books.
 */
export async function exportBooks(ctx: TenantContext, month: string): Promise<Result<{ file: string; zip: Buffer }, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  const books = await readBooks(ctx, month);
  if (!books.ok) return books;
  const sheets = exportSheets(books.value);
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
