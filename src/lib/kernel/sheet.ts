// A table for a spreadsheet export (SPEC-finance FN18). Pure: written as CSV here, as .xlsx in src/lib/xlsx.ts.

/** Text, money in centimes (bigint, never a float) or a calendar day "YYYY-MM-DD". */
export type Cell = string | bigint | { day: string };
export type Sheet = { name: string; header: string[]; rows: Cell[][] };

/** 123450n → "1234,50": French decimal comma, no thousands separator, so French Excel reads it as a number. */
export function decimal(centimes: bigint, point = ","): string {
  const abs = centimes < 0n ? -centimes : centimes;
  return `${centimes < 0n ? "-" : ""}${abs / 100n}${point}${String(abs % 100n).padStart(2, "0")}`;
}

const frDay = (day: string) => day.split("-").reverse().join("/"); // 2026-03-02 → 02/03/2026

// OWASP CSV injection: a text starting with = + - @ (or a tab / CR) would run as a formula when opened in Excel.
const text = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const quote = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
const csvCell = (c: Cell) => (typeof c === "bigint" ? decimal(c) : typeof c === "string" ? quote(text(c)) : frDay(c.day));

/** CSV as French Excel opens it by double-click: UTF-8 with BOM, ";" between fields, CRLF, dates dd/mm/yyyy. */
export function toCsv(sheet: Sheet): string {
  return `﻿${[sheet.header, ...sheet.rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
