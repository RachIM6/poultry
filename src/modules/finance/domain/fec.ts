import { decimal } from "@/lib/kernel/sheet";
import type { Line } from "@/modules/finance/domain/entry";
import type { EntryTags } from "@/modules/finance/domain/export";

// SPEC-finance FC10 (T118): the month's entries as a "fichier des écritures comptables" (FEC), the file Sage 100
// and EBP import. Built to the letter of article A47 A-1 of the French LPF (VI 1°, VII 1° and 4°, IX, XII); its
// 18 fields are, in the same order, those of CNC avis n° 24 (Morocco, 2023), annex point 3. docs/studies/accountant-import-format.md

/** An entry in the order it was validated (posted): `validated` is that farm day. */
export type FecEntry = { id: string; day: string; journal: string; label: string; lines: readonly Line[]; piece?: string | null; validated: string };

const JOURNALS: Record<string, string> = { AC: "Achats", VT: "Ventes", CA: "Caisse", BQ: "Banque", EF: "Effets et chèques", OD: "Opérations diverses" };

// VII 1°: the 18 fields in order, then (allowed: "les dix-huit premières informations") FN18's analytic tags.
const HEADER = ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise", "Tiers", "Ferme", "Batiment", "Lot"];

const date = (day: string) => day.replaceAll("-", ""); // XII 4°: AAAAMMJJ, no separator
const text = (s: string) => s.replace(/[\t\r\n]+/g, " "); // VI 1° c: the tab separates fields, so never inside one

/**
 * The FEC as text, to be written in UTF-8 without BOM (XII 1°): a tab between fields (VI 1° c), CRLF between records
 * (VI 1° a), the field names on the first line (VII 4°), amounts with a decimal comma and no thousands separator,
 * both Debit and Credit filled (XII 2°). EcritureNum runs 1, 2, 3… over the file in validation order; PieceRef is the
 * FN18 "Pièce" (a manual entry's piece, else the entry id, which names its receipt in the zip); PieceDate is the
 * entry's day. No sub-ledger accounts, lettering or foreign currency yet: those fields stay blank, as allowed.
 */
export function toFec(entries: readonly FecEntry[], labels: Record<string, string>, tags: EntryTags = new Map()): string {
  const rows = entries.flatMap((e, i) =>
    e.lines.map((l) => [e.journal, JOURNALS[e.journal] ?? e.journal, String(i + 1), date(e.day), l.account, labels[l.account] ?? "", "", "", e.piece || e.id, date(e.day), e.label, decimal(l.debit), decimal(l.credit), "", "", date(e.validated), "", "", ...(tags.get(e.id) ?? ["", "", "", ""])]),
  );
  return [HEADER, ...rows].map((r) => r.map(text).join("\t")).join("\r\n") + "\r\n";
}

/** IX's name, SirenFECAAAAMMJJ, without the Siren (a French register number; the entity has none): the period's last day. */
export const fecFileName = (lastDay: string) => `FEC${date(lastDay)}.txt`;
