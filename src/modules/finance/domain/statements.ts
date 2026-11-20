import type { TrialBalanceRow } from "@/modules/finance/domain/books";

export type StatementLine = { account: string; amount: bigint }; // a 3-digit CGNC account, its total
export type Section = { key: "operating" | "financial" | "nonCurrent" | "tax"; income: StatementLine[]; charges: StatementLine[]; result: bigint };

// CGNC classes 6 (charges) and 7 (produits): 61/71 exploitation, 63/73 financier, 65/75 non courant, 67 impôts sur
// les résultats. ⚠️ A draft, not the filed CPC: the accountant closes the year (inventories, depreciation).
const SECTIONS: { key: Section["key"]; income: string | null; charges: string }[] = [
  { key: "operating", income: "71", charges: "61" },
  { key: "financial", income: "73", charges: "63" },
  { key: "nonCurrent", income: "75", charges: "65" },
  { key: "tax", income: null, charges: "67" },
];

const byAccount = (rows: readonly TrialBalanceRow[], prefix: string, sign: 1n | -1n): StatementLine[] => {
  const totals = new Map<string, bigint>();
  for (const r of rows) if (r.account.startsWith(prefix)) totals.set(r.account.slice(0, 3), (totals.get(r.account.slice(0, 3)) ?? 0n) + sign * r.balance);
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([account, amount]) => ({ account, amount }));
};
const sum = (lines: readonly StatementLine[]) => lines.reduce((s, l) => s + l.amount, 0n);

/** The income statement (CPC) from a trial balance: income is credit (balance < 0), charges debit. */
export function incomeStatement(rows: readonly TrialBalanceRow[]) {
  const sections: Section[] = SECTIONS.map((s) => {
    const income = s.income ? byAccount(rows, s.income, -1n) : [];
    const charges = byAccount(rows, s.charges, 1n);
    return { key: s.key, income, charges, result: sum(income) - sum(charges) };
  });
  const [operating, financial, nonCurrent, tax] = sections.map((s) => s.result);
  const current = operating + financial;
  const beforeTax = current + nonCurrent;
  return { sections, current, beforeTax, net: beforeTax + tax };
}

export type IncomeStatement = ReturnType<typeof incomeStatement>;

// FC8, CGNC sides: class 1 (financement permanent) is a liability and class 2 (actif immobilisé) an asset whatever the
// sign, so 28/29 (amortissements, provisions) and 39/59 (provisions) are deducted on the asset side, and a debit in
// class 1 (1199, a loss) is deducted on the liability side. Classes 3–5 go by the account's sign, as the CGNC's
// reclassifications do: a supplier in debit is an asset (3411), a client in credit a liability (4421), an overdrawn
// bank a liability (554).
const sideOf = (r: TrialBalanceRow): "assets" | "liabilities" | null => {
  if (r.balance === 0n || !/^[1-5]/.test(r.account)) return null;
  if (r.account.startsWith("1")) return "liabilities";
  if (r.account.startsWith("2") || /^[35]9/.test(r.account)) return "assets";
  return r.balance > 0n ? "assets" : "liabilities";
};

/**
 * FC8: the draft balance sheet (bilan) from a trial balance: classes 1–5 by 3-digit account, and the CPC's net result
 * as its own liability line. Σ assets = Σ liabilities + result when the rows balance. ⚠️ A draft: "Projet" until the
 * year close (FCX6).
 */
export function balanceSheet(rows: readonly TrialBalanceRow[]) {
  const assets = byAccount(rows.filter((r) => sideOf(r) === "assets"), "", 1n);
  const liabilities = byAccount(rows.filter((r) => sideOf(r) === "liabilities"), "", -1n);
  const result = incomeStatement(rows).net;
  return { assets, liabilities, result, totalAssets: sum(assets), totalLiabilities: sum(liabilities) + result };
}
