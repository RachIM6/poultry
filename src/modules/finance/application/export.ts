import { ok, type Result } from "@/lib/kernel/result";
import { toCsv } from "@/lib/kernel/sheet";
import type { TenantContext } from "@/lib/tenant";
import { toXlsx } from "@/lib/xlsx";
import { zip } from "@/lib/zip";
import { readBooks } from "@/modules/finance/application/books";
import { exportSheets } from "@/modules/finance/domain/export";

/**
 * FN18: a month of books for the accountant, as one .zip: one CSV per sheet and the same sheets in one .xlsx.
 * Owners and managers only, like /books. Receipts join the zip when expenses keep a photo (not recorded yet).
 */
export async function exportBooks(ctx: TenantContext, month: string): Promise<Result<{ file: string; zip: Buffer }, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  const books = await readBooks(ctx, month);
  if (!books.ok) return books;
  const sheets = exportSheets(books.value);
  return ok({
    file: `comptabilite-${month}.zip`,
    zip: zip([...sheets.map((s) => ({ name: `${s.file}-${month}.csv`, data: toCsv(s) })), { name: `livres-${month}.xlsx`, data: toXlsx(sheets) }]),
  });
}
