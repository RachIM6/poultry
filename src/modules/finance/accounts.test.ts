import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AccountsFile } from "@/modules/finance/schema";
import { chartOf, postingAccount, rollUp } from "@/modules/finance";
import { operationAccounts } from "@/modules/finance/domain/operations";
import { POSTED_ACCOUNTS } from "@/modules/finance/domain/posting";
import { EXPENSE_ACCOUNTS } from "@/modules/finance/domain/treasury";
import { ASSET_ACCOUNTS, ASSET_DEBTS, DEPRECIATION_CHARGES, DISPOSAL_PROCEEDS, NET_BOOK_VALUE_DISPOSED } from "@/modules/finance/domain/assets";
import { LOAN_INTEREST, LOANS } from "@/modules/finance/domain/loans";
import { SUBSIDIES_RECEIVED, SUBSIDIES_RELEASED, SUBSIDY_RELEASE } from "@/modules/finance/domain/subsidies";
import { EGGS_STOCK, EGGS_VARIATION, IN_PROGRESS, IN_PROGRESS_PROVISION, IN_PROGRESS_VARIATION, PROVISION_CHARGE, PROVISION_REVERSAL, STOCK_ACCOUNTS, STOCK_PROVISION, stockAccountsOf } from "@/modules/finance/domain/stocks";

const seed = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
const everything = chartOf(seed.accounts, "cgnc", ["pca"]);
const withPca = everything;
const cgncOnly = chartOf(seed.accounts, "cgnc", []);

// Every account of SPEC-finance FN6's default posting rules, until T30 turns them into PostingRule rows.
// [rule account, account posted with PCA off (FN2's "CGNC parent" column)]
const RULE_ACCOUNTS: [string, string][] = [
  ["612121", "6121"], ["612122", "6121"], ["612123", "6122"],
  ["61221", "6122"], ["61223", "6122"], ["612511", "6125"], ["612512", "6125"], ["612612", "6126"],
  ["712121", "7121"], ["712128", "7121"], ["71213", "7121"],
  ["4411", "4411"], ["4415", "4415"], ["4463", "4463"],
  ["3421", "3421"], ["3424", "3424"], ["3425", "3425"], ["3431", "3431"],
  ["5111", "5111"], ["5113", "5113"], ["5115", "5115"], ["5141", "5141"], ["5161", "5161"],
  ["6134", "6134"], ["6136", "6136"],
];

describe("charts of accounts (SPEC-finance FN2, ADR-010 §2)", () => {
  it("has every account the default posting rules use, in both charts they target", () => {
    for (const [account, withoutPca] of RULE_ACCOUNTS) {
      expect(postingAccount(account, everything, withPca), account).toBe(account);
      expect(postingAccount(account, everything, cgncOnly), account).toBe(withoutPca);
    }
  });

  it("rolls up through the explicit parent: 612122 → 61212 → 6121 → 612 → 61 → 6", () => {
    expect(rollUp("612122", withPca)).toEqual(["612122", "61212", "6121", "612", "61", "6"]);
    expect(rollUp("712121", withPca)).toEqual(["712121", "71212", "7121", "712", "71", "7"]);
  });

  it("is a tree: every parent exists in the same charts, every account reaches its class", () => {
    for (const a of seed.accounts) {
      const path = rollUp(a.number, a.chart === "cgnc" ? cgncOnly : withPca);
      expect(path.at(-1), a.number).toBe(a.number[0]);
    }
    expect(new Set(seed.accounts.map((a) => `${a.chart}:${a.number}`)).size).toBe(seed.accounts.length);
  });

  it("keeps PCA accounts out of a chart without the overlay", () => {
    expect(cgncOnly.has("612122")).toBe(false);
    expect(() => rollUp("612122", cgncOnly)).toThrow();
  });

  // The official PCA nests 612123 under 61212 → 6121; without the PCA, FN2 posts vet products to 6122 (consumables).
  it("keeps the official tree for roll-ups and FN2's fallback for posting", () => {
    expect(rollUp("612123", withPca)).toEqual(["612123", "61212", "6121", "612", "61", "6"]);
    expect(postingAccount("612123", everything, cgncOnly)).toBe("6122");
  });

  it("has a fallback in the base chart for every overlay account", () => {
    for (const a of seed.accounts.filter((x) => x.chart !== "cgnc")) expect(cgncOnly.has(a.fallback ?? ""), a.number).toBe(true);
  });
  // Checked against the CGNC Tome I (docs/sources, SPEC-finance §9): numbers it doesn't have are PCA additions,
  // except 3132, kept in the base chart for 31322's fallback until FQ25 is answered.
  it("tags as PCA the numbers the CGNC doesn't have, with their CGNC parent as fallback", () => {
    for (const [number, parent] of [["1136", "113"], ["1353", "135"], ["1602", "160"], ["2317", "231"], ["3153", "315"], ["3917", "391"], ["6187", "618"], ["7162", "716"], ["7164", "716"], ["7187", "718"]]) {
      expect(cgncOnly.has(number), number).toBe(false);
      expect(withPca.get(number)?.fallback, number).toBe(parent);
    }
    expect(cgncOnly.has("7385")).toBe(true); // printed p. 308, read "1385" by the OCR
  });
  // CGNC scan p. 296 subdivides 6193 into 61931–61935 and 61938; PCA pp. 123–124 adds 61936 and 61937.
  it("subdivides 6193 as the CGNC does, the PCA's plantations and animals landing on 61938 without the PCA", () => {
    expect([...cgncOnly.values()].filter((a) => a.parent === "6193").map((a) => a.number)).toEqual(["61931", "61932", "61933", "61934", "61935", "61938"]);
    for (const number of ["61936", "61937"]) {
      expect(cgncOnly.has(number), number).toBe(false);
      expect(postingAccount(number, everything, cgncOnly), number).toBe("61938");
    }
  });
  it("gives every operation of the chart screen an account in both charts (F-Chart)", () => {
    for (const row of operationAccounts(seed.accounts)) expect([row.op, row.pca?.number, row.cgnc?.number].every(Boolean), row.op).toBe(true);
  });

  // T100: the accounts SPEC-finance §5 names, with the label printed in the PCA nomenclature (docs/sources).
  it("has every account SPEC-finance §5 names, with its printed label (T100)", () => {
    const named: [string, string][] = [
      ["1191", "Résultat net de l’exercice (créditeur)"], ["1199", "Résultat net de l’exercice (débiteur)"],
      ["1311", "Subventions d’investissement reçues"], ["1319", "Subventions d’investissement inscrites au compte de produits et charges"],
      ["1481", "Emprunts auprès des établissements de crédit"],
      ["2311", "Terrains nus"], ["2312", "Terrains aménagés"], ["23211", "Bâtiments d’exploitation"],
      ["233111", "Installations techniques Agricoles sur sol propre"], ["233112", "Installations techniques Agricoles sur terrain d’autrui"],
      ["2332", "Matériel et outillage"], ["2340", "Matériel de transport"],
      ["2351", "Mobilier de bureau"], ["2352", "Matériel de bureau"], ["2355", "Matériel informatique"],
      ["23711", "Animaux Reproducteurs Adultes"], ["23712", "Animaux Reproducteurs Jeunes de Renouvellement"], ["23962", "Immobilisations en cours - animaux"],
      ["2832", "Amortissements des constructions"], ["2833", "Amortissements des installations techniques, matériel et outillage"],
      ["2834", "Amortissements du matériel de transport"], ["2835", "Amortissements du mobilier, matériel de bureau et aménagements divers"],
      ["28371", "Amortissements des animaux reproducteurs"],
      ["3121", "Matières premières"], ["31221", "Matières consommables"], ["31223", "Combustibles"], ["3123", "Emballages"],
      ["31322", "Animaux"], ["3152", "Produits finis (d’animaux)"],
      ["3455", "État – TVA récupérable"], // seeded before T100: typographic differences only (§9)
      ["3912", "Provisions pour dépréciation des matières et fournitures"], ["3913", "Provisions pour dépréciation des produits en cours"],
      ["4463", "Comptes courants des associés créditeurs"], ["4481", "Dettes sur acquisition d’immobilisations"],
      ["5141", "Banques (soldes débiteurs)"], ["5161", "Caisses"],
      ["612121", "Achats d’Animaux"], ["612412", "Variation des stocks de matières premières Agricoles – Animaux"],
      ["61242", "Variation des stocks de Matières et Fournitures consommables"], ["61243", "Variation des stocks d’emballage"],
      ["6147", "Services bancaires"], ["6171", "Rémunération du personnel"],
      ["6193", "Dotations d’exploitation aux amortissements des immobilisations corporelles"],
      ["61932", "D.E.A. des constructions"], ["61933", "D.E.A. des installations techniques, matériel et outillage"],
      ["61934", "D.E.A. du matériel de transport"], ["61935", "D.E.A. des mobilier, matériel de bureau et aménagements divers"],
      ["61937", "D.E.A des Animaux"], ["61938", "D.E.A. des autres immobilisations corporelles"],
      ["6196", "Dotations d’exploitation aux provisions pour dépréciations de l’actif circulant"],
      ["6311", "Intérêts des emprunts et dettes"], ["6513", "VNA des immobilisations corporelles cédées"],
      ["712121", "Ventes d’animaux"], ["71213", "Ventes de produits d’animaux"],
      ["7131", "Variation des stocks de produits en cours"], ["7132", "Variation des stocks de biens produits"],
      ["7140", "Production Autoconsommée"], ["71431", "Immobilisations corporelles agricoles produites"],
      ["7151", "Variation d’inventaire : Animaux reproducteurs immobilisés Adulte"],
      ["7152", "Variation d’inventaire : Animaux reproducteurs immobilisés Jeunes de renouvellement"],
      ["7187", "Produits de cessions courantes d’éléments d’actif"], ["7196", "Reprises sur provisions pour dépréciation de l’actif circulant"],
      ["7513", "Produits des cessions des immobilisations corporelles"], ["7577", "Reprises sur subventions d’investissement de l’exercice"],
    ];
    for (const [number, label] of named) expect(withPca.get(number)?.label, number).toBe(label);
  });

  // FN4 refuses a line on an account with sub-accounts, so a rule's account must stay a leaf in the chart it posts to.
  // T100 left out the PCA sub-accounts of 3421, 3424, 4411 and 6136 for this reason (SPEC-finance §9).
  it("keeps every account a posting rule uses a posting account, in both charts", () => {
    const parents = (chart: typeof withPca) => new Set([...chart.values()].map((a) => a.parent));
    // T102 (FC1): every asset and depreciation account of the categories, and the acquisition and disposal accounts.
    const assets = [...Object.values(ASSET_ACCOUNTS).flatMap((a) => [a.asset, a.depreciation ?? []].flat()), ...Object.values(DEPRECIATION_CHARGES), ASSET_DEBTS, NET_BOOK_VALUE_DISPOSED, DISPOSAL_PROCEEDS];
    // T108 (FC5): the stock and variation accounts by kind, the provision and its reversal. T109 (FC4): the batches in progress.
    const stocks = [...Object.values(STOCK_ACCOUNTS).flatMap((a) => [a.stock, a.variation]), PROVISION_CHARGE, STOCK_PROVISION, PROVISION_REVERSAL, IN_PROGRESS, IN_PROGRESS_VARIATION, IN_PROGRESS_PROVISION];
    const rules = [...POSTED_ACCOUNTS.map((o) => o.account), ...Object.values(EXPENSE_ACCOUNTS), ...assets, LOANS, LOAN_INTEREST, SUBSIDIES_RECEIVED, SUBSIDIES_RELEASED, SUBSIDY_RELEASE, ...stocks]; // T105, T106 (FC2): the loans' and subsidies'
    expect(rules).toEqual(expect.arrayContaining(["3421", "3424", "4411", "6136", "23111", "233111", "2332", "2358", "2832", "2835", "4481", "61932", "61934", "6513", "7513", "1481", "6311", "1311", "1319", "7577", "3121", "31221", "31223", "612412", "61242", "6196", "3912", "7196", "31322", "7131", "3913", "6147"]));
    for (const account of rules) {
      expect(withPca.has(account), account).toBe(true);
      expect(parents(withPca).has(account), account).toBe(false);
      expect(parents(cgncOnly).has(postingAccount(account, everything, cgncOnly)), account).toBe(false);
    }
    // T109 (FC4, FQ1): with the PCA off, 31322 lands on 3132 Encours de Production, a CGNC leaf; 7131 and 3913 are CGNC's.
    expect([IN_PROGRESS, IN_PROGRESS_VARIATION, IN_PROGRESS_PROVISION].map((a) => postingAccount(a, everything, cgncOnly))).toEqual(["3132", "7131", "3913"]);
    // T113 (FC5, FQ25): the eggs post with the PCA only; without it 3152 lands on 315, which has sub-accounts.
    for (const account of [EGGS_STOCK, EGGS_VARIATION]) expect(parents(withPca).has(account), account).toBe(false);
    expect([EGGS_STOCK, EGGS_VARIATION].map((a) => postingAccount(a, everything, cgncOnly))).toEqual(["315", "7132"]);
    expect(parents(cgncOnly).has("315")).toBe(true);
  });

  // T108 (FC5, FQ1): the stock account follows the purchase's family in each chart (FN6: 6121 → 3121 / 61241x,
  // 6122 → 3122x / 61242), and with the PCA off each line lands on a CGNC posting account.
  it("posts bought stock by kind to the purchase's family, on a 6124 leaf, and on CGNC leaves with the PCA off", () => {
    const charge = (kind: string) => POSTED_ACCOUNTS.find((o) => o.op === (kind === "vaccine" || kind === "medicine" ? "vetProducts" : kind))?.account ?? "61221"; // other: as litter
    const rows = (pca: boolean) => {
      const chart = pca ? withPca : cgncOnly;
      return Object.keys(STOCK_ACCOUNTS).map((kind) => {
        const { stock, variation } = stockAccountsOf(kind as keyof typeof STOCK_ACCOUNTS, pca);
        const family = rollUp(postingAccount(charge(kind), everything, chart)!, chart).find((n) => n === "6121" || n === "6122");
        return [kind, family, postingAccount(stock, everything, chart), postingAccount(variation, everything, chart)];
      });
    };
    expect(rows(true)).toEqual([
      ["feed", "6121", "3121", "612412"],
      ["vaccine", "6121", "3121", "612412"],
      ["medicine", "6121", "3121", "612412"],
      ["litter", "6122", "31221", "61242"],
      ["other", "6122", "31221", "61242"],
      ["gas", "6122", "31223", "61242"],
    ]);
    expect(rows(false)).toEqual([
      ["feed", "6121", "3121", "61241"],
      ["vaccine", "6122", "31221", "61242"],
      ["medicine", "6122", "31221", "61242"],
      ["litter", "6122", "31221", "61242"],
      ["other", "6122", "31221", "61242"],
      ["gas", "6122", "31223", "61242"],
    ]);
  });
});
