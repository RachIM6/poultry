import type { FarmDay } from "@/lib/kernel/farm-day";
import { leafAccounts, postingAccount, type ChartOfAccounts } from "@/modules/finance/domain/chart";
import type { Line } from "@/modules/finance/domain/entry";
import { ASSET_DEBTS, ASSET_VAT_RECOVERABLE } from "@/modules/finance/domain/assets";
import { HENS_ADULTS, HENS_CULL_SALE, layPosting } from "@/modules/finance/domain/hens";
import { VAT_RECOVERABLE } from "@/modules/finance/domain/treasury";

/** A farm event finance posts (SPEC-finance FN6), read from a module's change log (FN7). Amounts in centimes. */
export type FarmEvent =
  | { type: "purchase"; id: string; day: FarmDay; itemKind: string; amount: bigint; paid: bigint; vat?: bigint; method?: string } // vat: part of amount (FN9); method: of the paid part, cash when absent
  | { type: "chicks"; id: string; day: FarmDay; amount: bigint; vat?: bigint; layers?: boolean } // the chicks bought at placement (SPEC B1); vat: on top of amount (FN9); layers: point-of-lay hens (FC6)
  | { type: "sale"; id: string; day: FarmDay; amount: bigint; paid: bigint; method: string; kind?: "live" | "eggs" | "perHead"; vat?: bigint; layers?: boolean } // SPEC V2, SPEC-m3 V6, V7; layers: from a laying flock (FC6)
  | { type: "lay"; id: string; day: FarmDay; amount: bigint; capitalised: bigint } // FC6: a pullet batch's FN13 cost at its transfer to lay, and at the last year end
  | { type: "receipt"; id: string; day: FarmDay; amount: bigint; method: string } // a later payment (SPEC V4)
  | { type: "consumption"; id: string; day: FarmDay; amount: bigint; takenBy: "exploitant" | "associate" | "employee" } // FC7, at its value
  | { type: "supplierPayment"; id: string; day: FarmDay; amount: bigint; method: string } // a later payment to a supplier (S2)
  | { type: "issuedDebit"; id: string; day: FarmDay; amount: bigint; kind: "cheque" | "bill" } // FN11: the bank debited what was issued
  | { type: "advance"; id: string; day: FarmDay; amount: bigint } // SPEC-m4 WF10: paid in cash
  | { type: "wagesPaid"; id: string; day: FarmDay; amount: bigint; from: "cash" | "bank" } // a validated month's net paid out
  // SPEC-m4 WF12: a validated pay month, all employees of a farm; contributions null until the CNSS rates are entered
  | { type: "pay"; id: string; day: FarmDay; gross: bigint; advances: bigint; employeeContribution: bigint | null; employerContribution: bigint | null; net: bigint }
  | { type: "instrument"; id: string; day: FarmDay; amount: bigint; kind: "cheque" | "bill"; from: string; to: string }; // FN11

export type Journal = "AC" | "VT" | "CA" | "BQ" | "EF" | "OD";
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
const PAID_AT_ONCE = "5161"; // the cash box: advances, and a purchase's paid part without a method
const BUYERS = "3421"; // Clients
const BIRDS_SOLD = "712121"; // Ventes d'animaux (per kg or per head: SPEC-m3 V8)
const EGGS_SOLD = "71213"; // Ventes de produits d'animaux (SPEC-m3 V8); 7121 without the PCA
const DOUBTFUL = "3424"; // Clients douteux ou litigieux: a cheque or bill that came back unpaid
const BANK = "5141";
const BILLS_PAYABLE = "4415"; // Fournisseurs - effets à payer
// SPEC-m4 pay, ⚠️ to confirm with the accountant (plan-m4 "Later"): CGNC accounts from the PCA nomenclature.
const STAFF_ADVANCES = "3431"; // Avances et acomptes au personnel
// 6171 and 6174 are subdivided (FN4; CGNC scan p. 294, PCA pp. 121–122): the pay goes on their leaves.
const SALARIES = "61711"; // Appointements et salaires
const SOCIAL_CHARGES = "61741"; // Cotisations de sécurité sociale: the employer's CNSS contribution
const WAGES_DUE = "4432"; // Rémunérations dues au personnel
const CNSS = "4441"; // Caisse Nationale de la Sécurité Sociale
// SPEC-finance FC7: home consumption, credited to 7140 Production Autoconsommée (714 with the PCA off, FQ25), debited to
// the associate's current account or, FQ21's default, the employee's pay as a benefit in kind (61713 Indemnités et
// avantages divers: pay "en numéraire ou en nature", PCA p. 121); the exploitant's account waits for FQ11.
const SELF_CONSUMED = "7140";
const TAKEN_BY: Partial<Record<string, string>> = { associate: "4463", employee: "61713" }; // 4463 Comptes courants des associés créditeurs
// FN6: where a later payment to a supplier comes from; an issued cheque leaves the bank on its issue date.
const PAID_OUT: Record<string, { account: string; journal: Journal }> = {
  cash: { account: "5161", journal: "CA" },
  transfer: { account: BANK, journal: "BQ" },
  cheque: { account: BANK, journal: "BQ" },
  bill: { account: BILLS_PAYABLE, journal: "OD" },
};
const VAT_COLLECTED = "4455"; // Etat, TVA facturée
// FN6: where money received from a buyer lands, and in which journal.
const RECEIVED: Record<string, { account: string; journal: Journal }> = {
  cash: { account: "5161", journal: "CA" },
  transfer: { account: BANK, journal: "BQ" },
  cheque: { account: "51111", journal: "EF" }, // Chèques en portefeuille
  bill: { account: "3425", journal: "EF" }, // Clients - effet à recevoir
};
// FN11: the account holding a received instrument in each state. 5111 and 5113 are subdivided by that state (FN4; CGNC
// scan p. 286): 51111 Chèques en portefeuille, 51112 Chèques à l’encaissement, 51132 Effets à l’encaissement.
const HELD: Record<string, Record<string, string>> = {
  cheque: { in_portfolio: "51111", remitted: "51112" },
  bill: { in_portfolio: "3425", remitted: "51132" }, // a bill in portfolio stays a receivable, 3425 Clients - effets à recevoir
};
const line = (account: string, debit: bigint, credit: bigint): Line => ({ account, debit, credit });

/** F-Chart: each operation these rules post and its PCA account, for the chart screen (read from the rules, never copied). */
export const POSTED_ACCOUNTS: readonly { op: string; account: string }[] = [
  { op: "chicks", account: CHICKS },
  { op: "feed", account: CHARGE_BY_ITEM.feed },
  { op: "vetProducts", account: CHARGE_BY_ITEM.vaccine },
  { op: "litter", account: CHARGE_BY_ITEM.litter },
  { op: "gas", account: CHARGE_BY_ITEM.gas },
  { op: "birdsSold", account: BIRDS_SOLD },
  { op: "eggsSold", account: EGGS_SOLD },
  { op: "buyers", account: BUYERS },
  { op: "doubtful", account: DOUBTFUL },
  { op: "suppliers", account: SUPPLIERS },
  { op: "billsPayable", account: BILLS_PAYABLE },
  { op: "salaries", account: SALARIES },
  { op: "socialCharges", account: SOCIAL_CHARGES },
  { op: "staffAdvances", account: STAFF_ADVANCES },
  { op: "wagesDue", account: WAGES_DUE },
  { op: "cnss", account: CNSS },
  { op: "cash", account: PAID_AT_ONCE },
  { op: "bank", account: BANK },
  { op: "cheques", account: RECEIVED.cheque.account },
  { op: "bills", account: RECEIVED.bill.account },
  { op: "chequesRemitted", account: HELD.cheque.remitted },
  { op: "billsRemitted", account: HELD.bill.remitted },
  { op: "vatRecoverable", account: VAT_RECOVERABLE },
  { op: "vatCollected", account: VAT_COLLECTED },
];

/**
 * FN6: the entry a farm event makes, in PCA accounts, or null when there is nothing to post (zero amount). FN9: a
 * VAT-registered entity books the invoice's VAT apart; otherwise the whole total stays on the charge or the sale.
 * `classicHens` (FC6, T115: a ledger with the PCA, laying hens by the classic method): point-of-lay hens bought go on
 * 23711 against 4481 (a fixed asset's debt, as FC1), culled hens sold on 7187, and the transfer to lay capitalises the pullets; otherwise as any batch.
 */
export function postingOf(e: FarmEvent, vatRegistered = false, classicHens = false): Posting | null {
  if (e.type === "pay" ? e.gross <= 0n : e.amount <= 0n) return null;
  const vat = vatRegistered && (e.type === "purchase" || e.type === "sale" || e.type === "chicks") ? (e.vat ?? 0n) : 0n;
  if (e.type === "sale") {
    const eggs = e.kind === "eggs";
    const lines = [line(BUYERS, e.amount, 0n), line(eggs ? EGGS_SOLD : classicHens && e.layers ? HENS_CULL_SALE : BIRDS_SOLD, 0n, e.amount - vat)];
    if (vat > 0n) lines.push(line(VAT_COLLECTED, 0n, vat));
    const received = RECEIVED[e.method];
    if (received && e.paid > 0n) lines.push(line(received.account, e.paid, 0n), line(BUYERS, 0n, e.paid));
    return { journal: "VT", label: eggs ? "Vente d’œufs" : "Vente", lines };
  }
  if (e.type === "consumption") {
    const debit = TAKEN_BY[e.takenBy];
    return debit ? { journal: "OD", label: "Autoconsommation", lines: [line(debit, e.amount, 0n), line(SELF_CONSUMED, 0n, e.amount)] } : null;
  }
  if (e.type === "advance") {
    // M4 records no payment method for an advance: from the cash box, as farms pay them (⚠️ like a purchase's paid part)
    return { journal: "CA", label: "Avance sur salaire", lines: [line(STAFF_ADVANCES, e.amount, 0n), line(PAID_AT_ONCE, 0n, e.amount)] };
  }
  if (e.type === "wagesPaid") {
    const from = e.from === "bank" ? { account: BANK, journal: "BQ" as const } : { account: PAID_AT_ONCE, journal: "CA" as const };
    return { journal: from.journal, label: "Salaires payés", lines: [line(WAGES_DUE, e.amount, 0n), line(from.account, 0n, e.amount)] };
  }
  if (e.type === "pay") {
    // Advances beyond the pay (net < 0) stay owed by the worker on 3431: only what the pay covers is taken back, so
    // the entry always balances (a lopsided one would block the posting pipeline at every push).
    const taken = e.net < 0n ? e.advances + e.net : e.advances;
    const lines = [line(SALARIES, e.gross, 0n)];
    if (taken > 0n) lines.push(line(STAFF_ADVANCES, 0n, taken));
    if (e.employeeContribution) lines.push(line(CNSS, 0n, e.employeeContribution));
    if (e.net > 0n) lines.push(line(WAGES_DUE, 0n, e.net));
    if (e.employerContribution) lines.push(line(SOCIAL_CHARGES, e.employerContribution, 0n), line(CNSS, 0n, e.employerContribution));
    return { journal: "OD", label: "Paie du mois", lines };
  }
  if (e.type === "supplierPayment") {
    const from = PAID_OUT[e.method];
    return from ? { journal: from.journal, label: "Paiement fournisseur", lines: [line(SUPPLIERS, e.amount, 0n), line(from.account, 0n, e.amount)] } : null;
  }
  if (e.type === "issuedDebit") {
    // FN6: an accepted bill leaves the bank at its due date; an issued cheque already left it on its issue day
    return e.kind === "bill" ? { journal: "BQ", label: "Effet payé à l’échéance", lines: [line(BILLS_PAYABLE, e.amount, 0n), line(BANK, 0n, e.amount)] } : null;
  }
  if (e.type === "receipt") {
    const received = RECEIVED[e.method];
    return received ? { journal: received.journal, label: "Encaissement", lines: [line(received.account, e.amount, 0n), line(BUYERS, 0n, e.amount)] } : null;
  }
  if (e.type === "instrument") {
    const from = HELD[e.kind][e.from];
    const to = e.to === "cashed" ? BANK : e.to === "unpaid" ? DOUBTFUL : HELD[e.kind][e.to];
    if (!from || !to || from === to) return null;
    const label = { remitted: "Remise à l’encaissement", cashed: "Encaissement", unpaid: "Impayé" }[e.to] ?? "";
    return { journal: e.to === "remitted" ? "EF" : "BQ", label, lines: [line(to, e.amount, 0n), line(from, 0n, e.amount)] };
  }
  if (e.type === "chicks") {
    // FN9: the placement's VAT comes on top of the chicks' price, so the debt is both; a registered entity recovers it
    // (34551 on point-of-lay hens, a fixed asset as FC1; 34552 on chicks, a charge), otherwise it is part of the cost.
    const hens = classicHens && e.layers;
    const total = e.amount + (e.vat ?? 0n);
    const lines = [line(hens ? HENS_ADULTS : CHICKS, total - vat, 0n)];
    if (vat > 0n) lines.push(line(hens ? ASSET_VAT_RECOVERABLE : VAT_RECOVERABLE, vat, 0n));
    lines.push(line(hens ? ASSET_DEBTS : SUPPLIERS, 0n, total));
    return { journal: "AC", label: hens ? "Achat de poules" : "Achat de poussins", lines };
  }
  if (e.type === "lay") return classicHens ? layPosting(e.amount, e.capitalised) : null;
  const lines: Line[] = [{ account: CHARGE_BY_ITEM[e.itemKind] ?? CHARGE_BY_ITEM.other, debit: e.amount - vat, credit: 0n }];
  if (vat > 0n) lines.push(line(VAT_RECOVERABLE, vat, 0n));
  if (e.amount > e.paid) lines.push({ account: SUPPLIERS, debit: 0n, credit: e.amount - e.paid });
  // FN6: the part paid at once leaves where a later supplier payment would (an issued cheque: the bank, on its day)
  if (e.paid > 0n) lines.push({ account: (PAID_OUT[e.method ?? "cash"] ?? PAID_OUT.cash).account, debit: 0n, credit: e.paid });
  return { journal: "AC", label: "Achat", lines };
}

/** The posting's lines in the entity's chart (PCA off → FN2's CGNC accounts), or null if an account has no home. */
export function inChart(p: Posting, everything: ChartOfAccounts, chart: ChartOfAccounts): Posting | null {
  const lines = p.lines.map((l) => ({ ...l, account: postingAccount(l.account, everything, chart) ?? "" }));
  return lines.every((l) => l.account) ? { ...p, lines } : null;
}

/**
 * FC7: why a home consumption posts nothing, or null when it posts. "noValue": the farm never sold the product, so it
 * is worth 0 (FQ21); "FQ11": the exploitant's account isn't known yet; "FQ25": without the PCA, 7140 lands on 714, which
 * has sub-accounts, so no line can go there and no account is invented (FN4).
 */
export function unpostedConsumption(e: Extract<FarmEvent, { type: "consumption" }>, everything: ChartOfAccounts, chart: ChartOfAccounts): "noValue" | "FQ11" | "FQ25" | null {
  const rule = postingOf(e);
  if (!rule) return e.amount > 0n ? "FQ11" : "noValue";
  const leaves = new Set(leafAccounts(chart).map((a) => a.number));
  return inChart(rule, everything, chart)?.lines.every((l) => leaves.has(l.account)) ? null : "FQ25";
}

/** Same day and same lines, in any order: a newer version of the source that changes nothing for the books. */
export function samePosting(a: { day: string; lines: readonly Line[] }, b: { day: string; lines: readonly Line[] }) {
  const key = (ls: readonly Line[]) => ls.map((l) => `${l.account}:${l.debit}:${l.credit}`).sort().join("|");
  return a.day === b.day && key(a.lines) === key(b.lines);
}
