import type { Cell, Sheet } from "@/lib/kernel/sheet";
import type { CashBookRow, TrialBalanceRow } from "@/modules/finance/domain/books";
import type { Line } from "@/modules/finance/domain/entry";

// SPEC-finance FN18: what the accountant gets for a period. Pure: the same books the /books screen shows.

type Books = {
  labels: Record<string, string>;
  cashBook: { rows: CashBookRow[]; receipts: bigint; expenses: bigint };
  journals?: { journal: string; entries: { id: string; day: string; label: string; lines: Line[]; piece?: string | null }[] }[]; // piece: a manual entry's (FCX3)
  trialBalance?: { rows: TrialBalanceRow[]; debit: bigint; credit: bigint };
  tags?: EntryTags; // FN16, FN18: each entry's party, farm, house and batch
};

/** FN18's analytic columns of an entry: party, farm, house, batch (its placement day), read from the record it posts. */
export type EntryTags = ReadonlyMap<string, readonly [party: string, farm: string, house: string, batch: string]>;

/** FN16's batch of an entry, as the books show it: its house and placement day ("B1 · 01/03/2026"), or nothing. */
export function batchOf(tags: EntryTags, entryId: string) {
  const [, , house, day] = tags.get(entryId) ?? [];
  return day ? `${house} · ${day}` : "";
}

/** The sheets of a period's export, each with the file name it gets as CSV. A `cash_book` entity only has its cash book. */
export function exportSheets(books: Books): (Sheet & { file: string })[] {
  const tags = books.tags ?? new Map();
  const label = (account: string) => books.labels[account] ?? "";
  const sheets: (Sheet & { file: string })[] = [];
  if (books.journals) {
    const rows: Cell[][] = books.journals.flatMap((j) =>
      j.entries.flatMap((e) => e.lines.map((l) => [{ day: e.day }, j.journal, e.piece || e.id, l.account, label(l.account), e.label, l.debit, l.credit, ...(tags.get(e.id) ?? ["", "", "", ""])])),
    );
    sheets.push({ name: "Écritures", file: "ecritures", header: ["Date", "Journal", "Pièce", "Compte", "Libellé du compte", "Libellé", "Débit", "Crédit", "Tiers", "Ferme", "Bâtiment", "Lot"], rows });
  }
  if (books.trialBalance) {
    const t = books.trialBalance;
    sheets.push({
      name: "Balance",
      file: "balance",
      header: ["Compte", "Libellé du compte", "Débit", "Crédit", "Solde"],
      rows: [...t.rows.map((r) => [r.account, label(r.account), r.debit, r.credit, r.balance]), ["Total", "", t.debit, t.credit, t.debit - t.credit]],
    });
  }
  const c = books.cashBook;
  sheets.push({
    name: "Recettes et dépenses",
    file: "recettes-depenses",
    header: ["Date", "Libellé", "Compte", "Libellé du compte", "Contrepartie", "Lot", "Recette", "Dépense"],
    rows: [
      ...c.rows.map((r) => [{ day: r.day }, r.label, r.account, label(r.account), r.counterAccounts.map((a) => `${a} ${label(a)}`).join(", "), batchOf(tags, r.entryId), r.receipt, r.expense]),
      ["Total", "", "", "", "", "", c.receipts, c.expenses],
    ],
  });
  return sheets;
}

const EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** A receipt's place in the zip: sorted by day, and the entry's id is the "Pièce" of the entries sheet. */
export const receiptName = (day: string, entryId: string, contentType: string) => `pieces/${day}_${entryId}.${EXTENSIONS[contentType] ?? "bin"}`;
