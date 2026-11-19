import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/kernel/sheet";
import { cashBookOf, trialBalance } from "@/modules/finance/domain/books";
import { exportSheets } from "@/modules/finance/domain/export";

// SPEC-finance FN18 (T38): the accountant's export of a period.
const sale = { id: "e1", day: "2026-03-20", label: "=Vente lot 1", lines: [{ account: "5161", debit: 300_000n, credit: 0n }, { account: "71211", debit: 0n, credit: 300_000n }] };
const expense = { id: "e2", day: "2026-03-21", label: "Électricité; mars", lines: [{ account: "61251", debit: 123_456n, credit: 0n }, { account: "5161", debit: 0n, credit: 123_456n }] };
const labels = { "5161": "Caisses", "71211": "Ventes de volailles", "61251": "Électricité" };
const lines = [...sale.lines, ...expense.lines];
const ledger = {
  labels,
  cashBook: cashBookOf([sale, expense]),
  journals: [{ journal: "CA", entries: [sale, expense] }],
  trialBalance: trialBalance(lines),
};

describe("export to the accountant (FN18)", () => {
  it("gives a ledger entity its entries, trial balance and cash book, as CSV French Excel opens", () => {
    const [entries, balance, cash] = exportSheets(ledger).map((s) => ({ file: s.file, csv: toCsv(s) }));
    expect([entries.file, balance.file, cash.file]).toEqual(["ecritures", "balance", "recettes-depenses"]);
    expect(entries.csv.split("\r\n")).toEqual([
      "﻿Date;Journal;Pièce;Compte;Libellé du compte;Libellé;Débit;Crédit;Tiers;Ferme;Bâtiment;Lot",
      "20/03/2026;CA;e1;5161;Caisses;'=Vente lot 1;3000,00;0,00;;;;", // a formula-looking label is defused
      "20/03/2026;CA;e1;71211;Ventes de volailles;'=Vente lot 1;0,00;3000,00;;;;",
      '21/03/2026;CA;e2;61251;Électricité;"Électricité; mars";1234,56;0,00;;;;',
      '21/03/2026;CA;e2;5161;Caisses;"Électricité; mars";0,00;1234,56;;;;',
      "",
    ]);
    expect(balance.csv).toContain("\r\n5161;Caisses;3000,00;1234,56;1765,44\r\n");
    expect(balance.csv).toMatch(/\r\nTotal;;4234,56;4234,56;0,00\r\n$/);
    expect(cash.csv).toContain("\r\n21/03/2026;\"Électricité; mars\";5161;Caisses;61251 Électricité;0,00;1234,56\r\n");
    expect(cash.csv).toMatch(/\r\nTotal;;;;;3000,00;1234,56\r\n$/);
  });

  it("gives a cash-book entity its cash book only", () => {
    expect(exportSheets({ labels, cashBook: ledger.cashBook }).map((s) => s.name)).toEqual(["Recettes et dépenses"]);
  });
});
