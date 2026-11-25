import { typedCentimes } from "@/lib/kernel/money";

// A table for a spreadsheet export (SPEC-finance FN18). Pure: written as CSV here, as .xlsx in src/lib/xlsx.ts.

/** Text, money in centimes (bigint, never a float) or a calendar day "YYYY-MM-DD". */
export type Cell = string | bigint | { day: string };
export type Sheet = { name: string; header: string[]; rows: Cell[][] };

const frDay = (day: string) => day.split("-").reverse().join("/"); // 2026-03-02 → 02/03/2026

// OWASP CSV injection: a text starting with = + - @ (or a tab / CR) would run as a formula when opened in Excel.
const text = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const quote = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
const csvCell = (c: Cell) => (typeof c === "bigint" ? typedCentimes(c) : typeof c === "string" ? quote(text(c)) : frDay(c.day));

/** CSV as French Excel opens it by double-click: UTF-8 with BOM, ";" between fields, CRLF, dates dd/mm/yyyy. */
export function toCsv(sheet: Sheet): string {
  return `﻿${[sheet.header, ...sheet.rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
