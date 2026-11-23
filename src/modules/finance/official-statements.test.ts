import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AccountsFile } from "@/modules/finance/schema";
import { chartOf, leafAccounts } from "@/modules/finance/domain/chart";
import { trialBalance } from "@/modules/finance/domain/books";
import { incomeStatement } from "@/modules/finance/domain/statements";
import { bilanTargets, CPC_CGNC, CPC_PCA, cpcTargets, eticTables, lineOf, officialBilan, officialCpc } from "@/modules/finance/domain/official-statements";

const seed = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
const charts = { cgnc: leafAccounts(chartOf(seed.accounts, "cgnc", [])), pca: leafAccounts(chartOf(seed.accounts, "cgnc", ["pca"])) };

describe("official statements mapping (SPEC-finance FC8, FQ22)", () => {
  it.each([false, true])("puts every class 1–5 posting account on one bilan line, and 6–7 on one CPC line (PCA %s)", (pca) => {
    const leaves = pca ? charts.pca : charts.cgnc;
    for (const [targets, re] of [[bilanTargets(pca), /^[1-5]/], [cpcTargets(pca ? CPC_PCA : CPC_CGNC), /^[67]/]] as const) {
      expect(new Set(targets.map(([prefix]) => prefix)).size, "a prefix listed twice").toBe(targets.length);
      const unmapped = leaves.filter((a) => re.test(a.number) && lineOf<unknown>(a.number, targets) === null).map((a) => a.number);
      expect(unmapped).toEqual([]);
    }
  });

  it("lands the PCA's biological assets on the PCA lines, and on the CGNC's 'divers' postes without the overlay", () => {
    expect(lineOf("23711", bilanTargets(true))).toEqual({ poste: "animaux", contra: false });
    expect(lineOf("28371", bilanTargets(true))).toEqual({ poste: "animaux", contra: true });
    expect(lineOf("2380", bilanTargets(false))).toEqual({ poste: "corporellesDiverses", contra: false });
    expect(lineOf("31322", bilanTargets(true))).toEqual({ poste: "stocksDivers", contra: false });
    expect(lineOf("7151", cpcTargets(CPC_PCA))).toBe("variationInventaire");
    expect(lineOf("7381", cpcTargets(CPC_PCA))).toBe("interetsProduits");
    expect(lineOf("7381", cpcTargets(CPC_CGNC))).toBe("produitsFinanciers");
  });
});

// A year of a farm with the PCA: opening balances, a batch sold, feed, a loan, depreciation, hens, a bank overdraft.
const lines = [
  // à-nouveaux
  { account: "1111", debit: 0n, credit: 10_000_000n },
  { account: "2328", debit: 8_000_000n, credit: 0n },
  { account: "2832", debit: 0n, credit: 1_000_000n },
  { account: "5161", debit: 3_000_000n, credit: 0n },
  // the year
  { account: "1481", debit: 0n, credit: 5_000_000n },
  { account: "5141", debit: 5_000_000n, credit: 0n }, // the loan
  { account: "23711", debit: 6_000_000n, credit: 0n },
  { account: "5141", debit: 0n, credit: 6_000_000n }, // hens bought: the bank is overdrawn by 1 000 000
  { account: "612122", debit: 4_000_000n, credit: 0n },
  { account: "4411", debit: 0n, credit: 4_000_000n },
  { account: "3421", debit: 9_000_000n, credit: 0n },
  { account: "712121", debit: 0n, credit: 9_000_000n },
  { account: "6193", debit: 900_000n, credit: 0n },
  { account: "2832", debit: 0n, credit: 500_000n },
  { account: "28371", debit: 0n, credit: 400_000n },
  { account: "6311", debit: 300_000n, credit: 0n },
  { account: "5161", debit: 0n, credit: 300_000n },
  { account: "31322", debit: 700_000n, credit: 0n },
  { account: "7132", debit: 0n, credit: 700_000n },
  { account: "6701", debit: 100_000n, credit: 0n },
  { account: "4453", debit: 0n, credit: 100_000n },
];
const rows = trialBalance(lines).rows;

describe("officialBilan and officialCpc on a fixture ledger", () => {
  it.each([false, true])("balances, its result the CPC's net and the draft's (PCA %s)", (pca) => {
    const bilan = officialBilan(rows, pca);
    expect(bilan.unmapped).toEqual([]);
    expect(bilan.totalActif).toBe(bilan.totalPassif);
    expect(bilan.result).toBe(officialCpc(rows, pca).net);
    expect(bilan.result).toBe(incomeStatement(rows).net);
  });

  it("shows gross, amortissements and net per poste, and the overdrawn bank as a passif", () => {
    const bilan = officialBilan(rows, true);
    const poste = (key: string) => [...bilan.actif, ...bilan.passif].flatMap((m) => m.rubriques.flatMap((r) => r.postes)).find((x) => x.key === key);
    expect(poste("constructions")).toMatchObject({ gross: 8_000_000n, contra: 1_500_000n, net: 6_500_000n });
    expect(poste("animaux")).toMatchObject({ gross: 6_000_000n, contra: 400_000n, net: 5_600_000n });
    expect(poste("banques")?.net).toBe(0n);
    expect(poste("banquesCrediteurs")?.net).toBe(1_000_000n);
    expect(poste("resultatNet")?.net).toBe(9_000_000n + 700_000n - 4_000_000n - 900_000n - 300_000n - 100_000n);
    expect(bilan.totalActif).toBe(6_500_000n + 5_600_000n + 700_000n + 9_000_000n + 2_700_000n);
  });

  it("follows the CPC's cascade: PCA (exploitation, financier) and CGNC (courant)", () => {
    const pca = officialCpc(rows, true);
    const res = (c: ReturnType<typeof officialCpc>, key: string) => c.results.find((r) => r.key === key)?.amount;
    expect(res(pca, "chiffreAffaires")).toBe(9_000_000n);
    expect(res(pca, "III")).toBe(9_000_000n + 700_000n - 4_000_000n - 900_000n);
    expect(res(pca, "VI")).toBe(-300_000n);
    expect(res(pca, "XIII")).toBe(pca.net);
    expect(res(pca, "XIV")! - res(pca, "XV")!).toBe(pca.net);
    const cgnc = officialCpc(rows, false);
    expect(res(cgnc, "III")).toBe(9_000_000n + 700_000n - 4_000_000n - 900_000n - 300_000n);
    expect(res(cgnc, "VIII")).toBe(cgnc.net);
    expect(res(cgnc, "valeurAjoutee")).toBe(9_000_000n + 700_000n - 4_000_000n);
  });
});

describe("eticTables (S1, S1 bis, S1-1, S1 ter)", () => {
  const opening = trialBalance(lines.slice(0, 4)).rows;
  const movements = trialBalance(lines.slice(4)).rows;
  const etic = eticTables(opening, movements, true);
  const of = (t: { key: string }[], key: string) => t.find((x) => x.key === key);

  it("moves each fixed asset from its opening to its closing gross value, and its amortissements", () => {
    expect(of(etic.s1, "constructions")).toMatchObject({ start: 8_000_000n, increase: 0n, decrease: 0n, end: 8_000_000n });
    expect(of(etic.s1, "animaux")).toMatchObject({ start: 0n, increase: 6_000_000n, end: 6_000_000n });
    expect(of(etic.s1bis, "constructions")).toMatchObject({ start: 1_000_000n, increase: 500_000n, decrease: 0n, end: 1_500_000n });
    expect(of(etic.s1_1!, "animauxImmobilisations")).toMatchObject({ end: 6_000_000n });
    expect(of(etic.s1ter!, "animauxEnCours")).toMatchObject({ start: 0n, end: 700_000n });
  });

  it("has no PCA tables without the overlay", () => {
    const cgnc = eticTables(opening, movements, false);
    expect(cgnc.s1_1).toBeUndefined();
    expect(cgnc.s1.map((x) => x.key)).not.toContain("animaux");
  });
});
