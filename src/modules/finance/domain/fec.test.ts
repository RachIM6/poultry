import { describe, expect, it } from "vitest";
import { fecFileName, toFec, type FecEntry } from "@/modules/finance/domain/fec";

// SPEC-finance FC10 (T118): a fixture month as the FEC of article A47 A-1 LPF (docs/studies/accountant-import-format.md).
const labels = { "5161": "Caisses", "71211": "Ventes de volailles", "61251": "Électricité", "4411": "Fournisseurs", "5141": "Banques" };
const entries: FecEntry[] = [
  { id: "e1", day: "2026-03-20", journal: "VT", label: "Vente lot 1", validated: "2026-03-20", lines: [{ account: "5161", debit: 300_000n, credit: 0n }, { account: "71211", debit: 0n, credit: 300_000n }] },
  { id: "e2", day: "2026-03-21", journal: "CA", label: "Électricité\tmars", validated: "2026-03-22", lines: [{ account: "61251", debit: 123_456n, credit: 0n }, { account: "5161", debit: 0n, credit: 123_456n }] },
  { id: "e3", day: "2026-03-31", journal: "OD", label: "Régularisation", piece: "OD-7", validated: "2026-04-02", lines: [{ account: "4411", debit: 5n, credit: 0n }, { account: "5141", debit: 0n, credit: 5n }] },
];
const tags = new Map([["e1", ["Hamid", "El Kheir", "B1", "01/03/2026"] as const]]);

const T = "\t";
const expected = [
  "JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise\tTiers\tFerme\tBatiment\tLot",
  ["VT", "Ventes", "1", "20260320", "5161", "Caisses", "", "", "e1", "20260320", "Vente lot 1", "3000,00", "0,00", "", "", "20260320", "", "", "Hamid", "El Kheir", "B1", "01/03/2026"].join(T),
  ["VT", "Ventes", "1", "20260320", "71211", "Ventes de volailles", "", "", "e1", "20260320", "Vente lot 1", "0,00", "3000,00", "", "", "20260320", "", "", "Hamid", "El Kheir", "B1", "01/03/2026"].join(T),
  ["CA", "Caisse", "2", "20260321", "61251", "Électricité", "", "", "e2", "20260321", "Électricité mars", "1234,56", "0,00", "", "", "20260322", "", "", "", "", "", ""].join(T),
  ["CA", "Caisse", "2", "20260321", "5161", "Caisses", "", "", "e2", "20260321", "Électricité mars", "0,00", "1234,56", "", "", "20260322", "", "", "", "", "", ""].join(T),
  ["OD", "Opérations diverses", "3", "20260331", "4411", "Fournisseurs", "", "", "OD-7", "20260331", "Régularisation", "0,05", "0,00", "", "", "20260402", "", "", "", "", "", ""].join(T),
  ["OD", "Opérations diverses", "3", "20260331", "5141", "Banques", "", "", "OD-7", "20260331", "Régularisation", "0,00", "0,05", "", "", "20260402", "", "", "", "", "", ""].join(T),
  "",
].join("\r\n");

describe("FEC export for the accountant's software (FC10)", () => {
  it("writes the fixture month byte for byte: UTF-8 without BOM, tabs, CRLF, AAAAMMJJ dates, decimal comma", () => {
    const bytes = Buffer.from(toFec(entries, labels, tags), "utf8");
    expect(bytes.equals(Buffer.from(expected, "utf8"))).toBe(true);
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]); // no BOM: the file starts with "JournalCode"
    expect(bytes.includes(Buffer.from([0xc3, 0x89]))).toBe(true); // "É" as UTF-8 (XII 1°), not ISO 8859-15's 0xC9
  });

  it("keeps every entry balanced: one EcritureNum per entry, Σ Debit = Σ Credit", () => {
    const rows = toFec(entries, labels).split("\r\n").slice(1, -1).map((r) => r.split("\t"));
    expect(rows.every((r) => r.length === 22)).toBe(true);
    const cents = (s: string) => BigInt(s.replace(",", ""));
    const sums = new Map<string, bigint>();
    for (const r of rows) sums.set(r[2], (sums.get(r[2]) ?? 0n) + cents(r[11]) - cents(r[12]));
    expect([...sums]).toEqual([["1", 0n], ["2", 0n], ["3", 0n]]);
  });

  it("maps each of our journals to its code and label, and each account to its number and the chart's label", () => {
    const journals = ["AC", "VT", "CA", "BQ", "EF", "OD"].map((journal, i) => ({ id: `j${i}`, day: "2026-03-01", journal, label: "x", validated: "2026-03-01", lines: [{ account: "5161", debit: 1n, credit: 0n }] }));
    const rows = toFec(journals, labels).split("\r\n").slice(1, -1).map((r) => r.split("\t"));
    expect(rows.map((r) => [r[0], r[1], r[4], r[5]])).toEqual([
      ["AC", "Achats", "5161", "Caisses"],
      ["VT", "Ventes", "5161", "Caisses"],
      ["CA", "Caisse", "5161", "Caisses"],
      ["BQ", "Banque", "5161", "Caisses"],
      ["EF", "Effets et chèques", "5161", "Caisses"],
      ["OD", "Opérations diverses", "5161", "Caisses"],
    ]);
  });

  it("names the file after IX's nomenclature, with the period's last day", () => {
    expect(fecFileName("2026-03-31")).toBe("FEC20260331.txt");
  });
});
