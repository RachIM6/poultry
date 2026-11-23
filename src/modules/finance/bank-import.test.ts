import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { csvAmount, csvRecords, parseCsvStatement, parseMt940, type CsvMapping } from "@/modules/finance/domain/bank-import";
import { pairImported, type BankLine } from "@/modules/finance/domain/bank";

// SPEC-finance FC9, T117. The fixtures are synthetic, written by hand from the MT940 field definitions
// (fixtures/bank/README.md); each file is read as bytes and parsed as it is.
const fixture = (name: string, encoding = "utf-8") => new TextDecoder(encoding).decode(readFileSync(`src/modules/finance/fixtures/bank/${name}`));
const d = (day: string) => day as FarmDay;
const ok = (r: ReturnType<typeof parseMt940>) => {
  if (!r.ok) throw new Error(`${r.error} at line ${r.line}`);
  return r.value;
};

describe("MT940 (SWIFT customer statement)", () => {
  it("reads the one-statement fixture byte for byte: envelope, CRLF, funds code, two-line :86:", () => {
    const text = fixture("synthetic-one-statement.sta");
    expect(text).toContain("\r\n");
    expect(ok(parseMt940(text))).toEqual([
      {
        account: "999999000000000000000001",
        number: "00011",
        endDay: "2026-03-14",
        openingCentimes: 0n,
        closingCentimes: 4_350_000n,
        lines: [
          { day: "2026-03-02", amount: 5_000_000n, label: "VERSEMENT ESPECES - DONNEES SYNTHETIQUES", reference: "NONREF//SYN0001" },
          { day: "2026-03-05", amount: -120_000n, label: "PRELEVEMENT ELECTRICITE FACTURE SYNTHETIQUE 0001", reference: "NONREF//SYN0002" },
          { day: "2026-03-09", amount: -30_000n, label: "PRELEVEMENT EAU", reference: "NONREF//SYN0003" },
          { day: "2026-03-12", amount: -500_000n, label: "RETRAIT ESPECES", reference: "NONREF//SYN0004" },
        ],
      },
    ]);
    expect(parseMt940(text.replaceAll("\r\n", "\n"))).toEqual(parseMt940(text)); // LF only reads the same
  });

  it("reads several statements, joins a statement's pages, and signs overdrafts and reversals", () => {
    const [first, second] = ok(parseMt940(fixture("synthetic-multi-statement.sta")));
    expect(first).toEqual({
      account: "999999000000000000000002",
      number: "1",
      endDay: "2026-01-02", // the :62F: of page 2
      openingCentimes: -100_000n, // D 1000,00: overdrawn
      closingCentimes: -140_025n,
      lines: [
        { day: "2025-12-30", amount: 250_050n, label: "VIREMENT RECU CLIENT SYNTHETIQUE", reference: "REF1//SYN0101" },
        { day: "2025-12-31", amount: -10_000n, label: "FRAIS DE TENUE DE COMPTE", reference: "NONREF" },
        { day: "2026-01-02", amount: -40_025n, label: "CHEQUE 0000001 PAIEMENT ALIMENT SYNTHETIQUE", reference: "NONREF//SYN0102" }, // value 31 Dec 2025, entry 2 Jan
        { day: "2026-01-02", amount: -250_050n, label: "ANNULATION VIREMENT", reference: "REF1//SYN0103" }, // RC: a credit reversed
        { day: "2026-01-02", amount: 10_000n, label: "NONREF//SYN0104", reference: "NONREF//SYN0104" }, // RD; no :86:, the reference
      ],
    });
    // No entry date: the value date. The message's own :86: (after :62F:) and :64: are not lines.
    expect(second).toEqual({ account: "999999000000000000000002", number: "2", endDay: "2026-01-05", openingCentimes: -140_025n, closingCentimes: 0n, lines: [{ day: "2026-01-05", amount: 140_025n, label: "NONREF", reference: "NONREF" }] });
  });

  const one = fixture("synthetic-one-statement.sta");
  const lineOf = (text: string, needle: string) => text.split("\r\n").findIndex((l) => l.startsWith(needle)) + 1;

  it("refuses a statement whose opening balance plus its lines isn't its closing balance, at the :62F: line", () => {
    const wrong = one.replace(":62F:C260314MAD43500,00", ":62F:C260314MAD43500,01");
    expect(parseMt940(wrong)).toEqual({ ok: false, error: "IMPORT_BALANCE", line: lineOf(wrong, ":62F:") });
    const multi = fixture("synthetic-multi-statement.sta");
    expect(parseMt940(multi.replace(":62M:C251231MAD1400,50", ":62M:C251231MAD1400,51"))).toMatchObject({ ok: false, error: "IMPORT_BALANCE", line: 9 }); // each page balances
  });

  it("refuses pages that don't follow each other, and a file ending on an intermediate page", () => {
    const multi = fixture("synthetic-multi-statement.sta");
    expect(parseMt940(multi.replace(":60M:C251231MAD1400,50", ":60F:C251231MAD1400,50"))).toMatchObject({ ok: false, error: "IMPORT_INCOMPLETE", line: 14 });
    expect(parseMt940(multi.replace(":62M:C251231MAD1400,50", ":62M:C251231MAD1400,50").replace(":60M:C251231MAD1400,50", ":60M:C251231MAD1400,49").replace(":61:2512310102D400,25", ":61:2512310102D400,24"))).toMatchObject({ ok: false, error: "IMPORT_INCOMPLETE", line: 14 });
    expect(parseMt940(one.replace(":62F:", ":62M:"))).toMatchObject({ ok: false, error: "IMPORT_INCOMPLETE" });
    expect(parseMt940(one.replace(":60F:", ":60M:"))).toMatchObject({ ok: false, error: "IMPORT_INCOMPLETE" });
  });

  it("refuses fields that don't match their format, with their line", () => {
    const bad = (from: string, to: string, error = "IMPORT_FIELD") => expect(parseMt940(one.replace(from, to))).toEqual({ ok: false, error, line: lineOf(one, from) });
    bad(":61:2603020302C50000,00", ":61:2602300302C50000,00"); // 30 February
    bad(":61:2603020302C50000,00", ":61:2603020302C50000.00"); // a decimal point
    bad(":61:2603020302C50000,00", ":61:2603020302C50000,001"); // 3 decimals: MAD has 2
    bad(":61:2603020302C50000,00", ":61:2603020302X50000,00"); // no such mark
    bad(":61:2603020302C50000,00", ":61:2603020302C50000"); // no decimal comma
    bad(":60F:C260301MAD0,00", ":60F:C260301EUR0,00", "IMPORT_CURRENCY");
    bad(":28C:00011/1", ":28C:ABC");
  });

  it("refuses what isn't an MT940 statement", () => {
    expect(parseMt940("")).toEqual({ ok: false, error: "IMPORT_EMPTY", line: 0 });
    expect(parseMt940("Date;Libellé;Montant\r\n")).toEqual({ ok: false, error: "IMPORT_FORMAT", line: 1 });
    expect(parseMt940(one.replace(":25:999999000000000000000001\r\n", ""))).toMatchObject({ ok: false, error: "IMPORT_FORMAT" }); // no account
    expect(parseMt940(one.replace(":86:PRELEVEMENT EAU", ":64:C260309MAD0,"))).toEqual({ ok: false, error: "IMPORT_FORMAT", line: lineOf(one, ":86:PRELEVEMENT EAU") });
    const second = one.replace("{1:", "").replace(/^.*?\{4:\r\n/, "").replace("999999000000000000000001", "999999000000000000000009").replace("-}", "-");
    expect(parseMt940(`${one}\r\n${second}`)).toEqual({ ok: false, error: "IMPORT_ACCOUNTS", line: 0 });
  });
});

describe("CSV with the owner's column mapping", () => {
  const mapping: CsvMapping = { separator: ";", skipLines: 1, dateColumn: 1, dateFormat: "DD/MM/YYYY", labelColumn: 2, amountColumn: null, debitColumn: 3, creditColumn: 4, decimalComma: true };
  const csv = fixture("synthetic-debit-credit.csv", "windows-1252");

  it("reads the debit / credit fixture: quotes, thousands separators, the balance row without a date skipped", () => {
    expect(parseCsvStatement(csv, mapping, d("2026-03-14"), 4_350_000n)).toEqual({
      ok: true,
      value: [
        {
          account: null,
          number: null,
          endDay: "2026-03-14",
          openingCentimes: null,
          closingCentimes: 4_350_000n,
          lines: [
            { day: "2026-03-02", amount: 5_000_000n, label: "VERSEMENT ESPECES; SYNTHETIQUE", reference: "" },
            { day: "2026-03-05", amount: -120_000n, label: "PRELEVEMENT ELECTRICITE", reference: "" },
            { day: "2026-03-09", amount: -30_000n, label: "PRELEVEMENT EAU", reference: "" },
            { day: "2026-03-12", amount: -500_000n, label: 'RETRAIT "ESPECES"', reference: "" },
          ],
        },
      ],
    });
  });

  it("reads a signed amount column with a decimal point, ISO dates and commas", () => {
    const text = 'date,amount,label\n2026-03-02,"50,000.00",Deposit\n2026-03-05,-1200.5,"Power\nbill"\n';
    const r = parseCsvStatement(text, { ...mapping, separator: ",", dateFormat: "YYYY-MM-DD", dateColumn: 1, amountColumn: 2, labelColumn: 3, debitColumn: null, creditColumn: null, decimalComma: false }, d("2026-03-31"), 0n);
    expect(r.ok && r.value[0].lines).toEqual([
      { day: "2026-03-02", amount: 5_000_000n, label: "Deposit", reference: "" },
      { day: "2026-03-05", amount: -120_050n, label: "Power bill", reference: "" },
    ]);
  });

  it("refuses a row it can't read, a row after the end day, and a file without rows, with the file line", () => {
    expect(parseCsvStatement(csv, mapping, d("2026-03-10"), 0n)).toEqual({ ok: false, error: "IMPORT_AFTER_END", line: 5 });
    expect(parseCsvStatement(csv, { ...mapping, dateFormat: "YYYY-MM-DD" }, d("2026-03-14"), 0n)).toEqual({ ok: false, error: "IMPORT_FIELD", line: 2 });
    expect(parseCsvStatement(csv, { ...mapping, skipLines: 0 }, d("2026-03-14"), 0n)).toEqual({ ok: false, error: "IMPORT_FIELD", line: 1 }); // the header read as a row
    expect(parseCsvStatement(csv, { ...mapping, decimalComma: false }, d("2026-03-14"), 0n)).toEqual({ ok: false, error: "IMPORT_FIELD", line: 2 });
    expect(parseCsvStatement("Date;Libellé\r\n", mapping, d("2026-03-14"), 0n)).toEqual({ ok: false, error: "IMPORT_EMPTY", line: 0 });
    expect(parseCsvStatement("31/02/2026;x;1,00;\r\n", { ...mapping, skipLines: 0 }, d("2026-03-14"), 0n)).toEqual({ ok: false, error: "IMPORT_FIELD", line: 1 });
  });

  it("parses amounts exactly and records with RFC 4180 quotes", () => {
    expect(["1 234,56", "-1.234,5", "+0,01", "12", "1,234", "1,2,3", "", "12.34,5"].map((x) => csvAmount(x, true))).toEqual([123_456n, -123_450n, 1n, 1_200n, null, null, null, null]);
    expect(["1,234.56", "-0.5", "1.234", "50 000,00", "1 234.5"].map((x) => csvAmount(x, false))).toEqual([123_456n, -50n, null, null, 123_450n]);
    expect(csvRecords('a;"b;""c"""\r\n"d\r\ne";f', ";")).toEqual([
      { cells: ["a", 'b;"c"'], line: 1 },
      { cells: ["d\r\ne", "f"], line: 2 },
    ]);
  });
});

describe("handing imported lines to the manual matching", () => {
  const statement = { id: "s", endDay: d("2026-03-14"), closingCentimes: 0n };
  const book = (id: string, day: string, amount: bigint, match: BankLine["match"] = null): BankLine => ({ id, day: d(day), amount, match });

  it("pairs each statement line with one book line of the same amount: ticked here first, else the nearest untickable one", () => {
    const lines = [
      book("fee-a", "2026-03-01", -500n),
      book("fee-b", "2026-03-10", -500n),
      book("ticked", "2026-03-02", 1_000n, { statementId: "s", endDay: d("2026-03-14") }),
      book("elsewhere", "2026-03-02", 1_000n, { statementId: "older", endDay: d("2026-02-28") }),
      book("after", "2026-03-20", 7_000n),
    ];
    const imported = [
      { id: "i1", day: d("2026-03-09"), amount: -500n },
      { id: "i2", day: d("2026-03-02"), amount: -500n },
      { id: "i3", day: d("2026-03-02"), amount: 1_000n },
      { id: "i4", day: d("2026-03-03"), amount: 1_000n }, // the other 1 000 is ticked on another statement
      { id: "i5", day: d("2026-03-14"), amount: 7_000n }, // the book line is after the end day
      { id: "i6", day: d("2026-03-05"), amount: -500n }, // both fees taken
    ];
    expect(Object.fromEntries(pairImported(statement, imported, lines))).toEqual({
      i1: { lineId: "fee-b", ticked: false },
      i2: { lineId: "fee-a", ticked: false },
      i3: { lineId: "ticked", ticked: true },
    });
  });
});
