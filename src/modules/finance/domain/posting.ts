import type { FarmDay } from "@/lib/kernel/farm-day";
import { postingAccount, type ChartOfAccounts } from "@/modules/finance/domain/chart";
import type { Line } from "@/modules/finance/domain/entry";

/** A farm event finance posts (SPEC-finance FN6), read from a module's change log (FN7). Amounts in centimes. */
export type FarmEvent =
  | { type: "purchase"; id: string; day: FarmDay; itemKind: string; amount: bigint; paid: bigint; vat?: bigint } // vat: part of amount (FN9)
  | { type: "chicks"; id: string; day: FarmDay; amount: bigint } // the chicks bought at placement (SPEC B1)
  | { type: "sale"; id: string; day: FarmDay; amount: bigint; paid: bigint; method: string; kind?: "live" | "eggs" | "perHead"; vat?: bigint } // SPEC V2, SPEC-m3 V6, V7
  | { type: "receipt"; id: string; day: FarmDay; amount: bigint; method: string } // a later payment (SPEC V4)
  | { type: "instrument"; id: string; day: FarmDay; amount: bigint; kind: "cheque" | "bill"; from: string; to: string }; // FN11

export type Journal = "AC" | "VT" | "CA" | "BQ" | "EF";
export type Posting = { journal: Journal; label: string; lines: Line[] };

// FN6 default rules, with PCA accounts; postingAccount() maps them to the entity's chart (FN2 fallbacks).
// ⚠️ ADR-010 is proposed: the accountant reviews these (checkpoint M2-finance).
const CHARGE_BY_ITEM: Record<string, string> = {
  feed: "612122", // Aliments de bétail
  vaccine: "612123", // Produits vétérinaires et autres produits de défense des animaux
  medicine: "612123",
  litter: "61221", // Achats de matières et fournitures
  gas: "61223", // Combustibles
  other: "61221", // FN6 has no rule for "other": matières et fournitures until the accountant says otherwise
};
const CHICKS = "612121"; // Achats d'animaux
const SUPPLIERS = "4411";
// M1 doesn't record how a purchase was paid at once: cash (5161) until purchases carry a payment method (T32).
const PAID_AT_ONCE = "5161";
const BUYERS = "3421"; // Clients
const BIRDS_SOLD = "712121"; // Ventes d'animaux (per kg or per head: SPEC-m3 V8)
const EGGS_SOLD = "71213"; // Ventes de produits d'animaux (SPEC-m3 V8); 7121 without the PCA
const DOUBTFUL = "3424"; // Clients douteux ou litigieux: a cheque or bill that came back unpaid
const BANK = "5141";
// FN9: the PCA nomenclature lists 3455 "Etat - TVA récupérable" without the CGNC's 34552 split (FQ4 for the accountant).
const VAT_RECOVERABLE = "3455";
const VAT_COLLECTED = "4455"; // Etat, TVA facturée
// FN6: where money received from a buyer lands, and in which journal.
const RECEIVED: Record<string, { account: string; journal: Journal }> = {
  cash: { account: "5161", journal: "CA" },
  transfer: { account: BANK, journal: "BQ" },
  cheque: { account: "5111", journal: "EF" }, // Chèques à encaisser
  bill: { account: "3425", journal: "EF" }, // Clients - effet à recevoir
};
// FN11: the account holding a received instrument in each state (a cheque stays on 5111 until cashed).
const HELD: Record<string, Record<string, string>> = {
  cheque: { in_portfolio: "5111", remitted: "5111" },
  bill: { in_portfolio: "3425", remitted: "5113" }, // Effets à encaisser
};
const line = (account: string, debit: bigint, credit: bigint): Line => ({ account, debit, credit });

/**
 * FN6: the entry a farm event makes, in PCA accounts, or null when there is nothing to post (zero amount). FN9: a
 * VAT-registered entity books the invoice's VAT apart; otherwise the whole total stays on the charge or the sale.
 */
export function postingOf(e: FarmEvent, vatRegistered = false): Posting | null {
  if (e.amount <= 0n) return null;
  const vat = vatRegistered && (e.type === "purchase" || e.type === "sale") ? (e.vat ?? 0n) : 0n;
  if (e.type === "sale") {
    const eggs = e.kind === "eggs";
    const lines = [line(BUYERS, e.amount, 0n), line(eggs ? EGGS_SOLD : BIRDS_SOLD, 0n, e.amount - vat)];
    if (vat > 0n) lines.push(line(VAT_COLLECTED, 0n, vat));
    const received = RECEIVED[e.method];
    if (received && e.paid > 0n) lines.push(line(received.account, e.paid, 0n), line(BUYERS, 0n, e.paid));
    return { journal: "VT", label: eggs ? "Vente d’œufs" : "Vente", lines };
  }
  if (e.type === "receipt") {
    const received = RECEIVED[e.method];
    return received ? { journal: received.journal, label: "Encaissement", lines: [line(received.account, e.amount, 0n), line(BUYERS, 0n, e.amount)] } : null;
  }
  if (e.type === "instrument") {
    const from = HELD[e.kind][e.from];
    const to = e.to === "cashed" ? BANK : e.to === "unpaid" ? DOUBTFUL : HELD[e.kind][e.to];
    if (!from || !to || from === to) return null; // a cheque remitted to the bank stays on 5111: nothing to post
    const label = { remitted: "Remise à l’encaissement", cashed: "Encaissement", unpaid: "Impayé" }[e.to] ?? "";
    return { journal: e.to === "remitted" ? "EF" : "BQ", label, lines: [line(to, e.amount, 0n), line(from, 0n, e.amount)] };
  }
  if (e.type === "chicks") {
    return { journal: "AC", label: "Achat de poussins", lines: [{ account: CHICKS, debit: e.amount, credit: 0n }, { account: SUPPLIERS, debit: 0n, credit: e.amount }] };
  }
  const lines: Line[] = [{ account: CHARGE_BY_ITEM[e.itemKind] ?? CHARGE_BY_ITEM.other, debit: e.amount - vat, credit: 0n }];
  if (vat > 0n) lines.push(line(VAT_RECOVERABLE, vat, 0n));
  if (e.amount > e.paid) lines.push({ account: SUPPLIERS, debit: 0n, credit: e.amount - e.paid });
  if (e.paid > 0n) lines.push({ account: PAID_AT_ONCE, debit: 0n, credit: e.paid });
  return { journal: "AC", label: "Achat", lines };
}

/** The posting's lines in the entity's chart (PCA off → FN2's CGNC accounts), or null if an account has no home. */
export function inChart(p: Posting, everything: ChartOfAccounts, chart: ChartOfAccounts): Posting | null {
  const lines = p.lines.map((l) => ({ ...l, account: postingAccount(l.account, everything, chart) ?? "" }));
  return lines.every((l) => l.account) ? { ...p, lines } : null;
}

/** Same day and same lines, in any order: a newer version of the source that changes nothing for the books. */
export function samePosting(a: { day: string; lines: readonly Line[] }, b: { day: string; lines: readonly Line[] }) {
  const key = (ls: readonly Line[]) => ls.map((l) => `${l.account}:${l.debit}:${l.credit}`).sort().join("|");
  return a.day === b.day && key(a.lines) === key(b.lines);
}
