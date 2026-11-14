import type { FarmDay } from "@/lib/kernel/farm-day";
import { postingAccount, type ChartOfAccounts } from "@/modules/finance/domain/chart";
import type { Line } from "@/modules/finance/domain/entry";

/** A farm event finance posts (SPEC-finance FN6), read from a module's change log (FN7). Amounts in centimes. */
export type FarmEvent =
  | { type: "purchase"; id: string; day: FarmDay; itemKind: string; amount: bigint; paid: bigint }
  | { type: "chicks"; id: string; day: FarmDay; amount: bigint }; // the chicks bought at placement (SPEC B1)

export type Posting = { journal: "AC"; label: string; lines: Line[] };

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

/** FN6: the entry a farm event makes, in PCA accounts, or null when there is nothing to post (zero amount). */
export function postingOf(e: FarmEvent): Posting | null {
  if (e.amount <= 0n) return null;
  if (e.type === "chicks") {
    return { journal: "AC", label: "Achat de poussins", lines: [{ account: CHICKS, debit: e.amount, credit: 0n }, { account: SUPPLIERS, debit: 0n, credit: e.amount }] };
  }
  const lines: Line[] = [{ account: CHARGE_BY_ITEM[e.itemKind] ?? CHARGE_BY_ITEM.other, debit: e.amount, credit: 0n }];
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
