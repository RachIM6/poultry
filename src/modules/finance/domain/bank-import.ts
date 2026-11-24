import type { FarmDay } from "@/lib/kernel/farm-day";

// SPEC-finance FC9, T117: bank statement files, read into statements of integer centimes. Pure: the file's text in,
// statements or the first error out, with the file line it was found on. Nothing in a file is executed or trusted:
// every field is matched against its published format. Sources: docs/studies/bank-statement-formats.md.

/** A statement line as the bank printed it: signed for the account holder (a credit +, a debit −), like a 5141 line. */
export type ImportedLine = { day: FarmDay; amount: bigint; label: string; reference: string };
export type ImportedStatement = { account: string | null; number: string | null; endDay: FarmDay; openingCentimes: bigint | null; closingCentimes: bigint; lines: ImportedLine[] };
export type ImportError =
  | "IMPORT_EMPTY" // no statement in the file
  | "IMPORT_FORMAT" // not the format chosen: text outside a field, a field missing or out of order
  | "IMPORT_FIELD" // a field that doesn't match its format (date, amount, mark)
  | "IMPORT_CURRENCY" // a balance not in MAD: the books are in dirhams
  | "IMPORT_BALANCE" // opening + Σ lines ≠ closing
  | "IMPORT_INCOMPLETE" // a statement whose pages (:60M: / :62M:) don't follow each other
  | "IMPORT_ACCOUNTS" // statements of several accounts in one file
  | "IMPORT_AFTER_END"; // a CSV line after the statement's end day
export type Parsed = { ok: true; value: ImportedStatement[] } | { ok: false; error: ImportError; line: number };

const failAt = (error: ImportError, line: number): Parsed => ({ ok: false, error, line });
const LABEL_MAX = 500;
const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);

/** A calendar day, or null when it doesn't exist (31 April). */
function dayOf(year: number, month: number, day: number): FarmDay | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? (d.toISOString().slice(0, 10) as FarmDay) : null;
}

/** SWIFT "15d": digits, one decimal comma (mandatory), at most 2 decimals for MAD (ISO 4217). Exact: no float. */
function swiftAmount(text: string): bigint | null {
  const m = /^(\d+),(\d{0,2})$/.exec(text);
  return m && text.length <= 15 ? BigInt(m[1]) * 100n + BigInt(m[2].padEnd(2, "0")) : null;
}

/** SWIFT "6!n" date YYMMDD. SWIFT gives no century: 20YY. */
const swiftDay = (text: string) => dayOf(2000 + Number(text.slice(0, 2)), Number(text.slice(2, 4)), Number(text.slice(4, 6)));

type Field = { tag: string; value: string; line: number };
type Balance = { final: boolean; day: FarmDay; centimes: bigint; line: number };

/** :60a: / :62a: "1!a6!n3!a15d": D/C mark, date, currency, amount. A debit (D) balance is an overdraft: negative. */
function balance(f: Field): { ok: true; value: Balance } | { ok: false; error: ImportError } {
  const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)$/.exec(f.value);
  const day = m && swiftDay(m[2]);
  const amount = m && swiftAmount(m[4]);
  if (!m || !day || amount === null) return { ok: false, error: "IMPORT_FIELD" };
  if (m[3] !== "MAD") return { ok: false, error: "IMPORT_CURRENCY" };
  return { ok: true, value: { final: f.tag.endsWith("F"), day, centimes: m[1] === "D" ? -amount : amount, line: f.line } };
}

/**
 * :61: "6!n[4!n]2a[1!a]15d1!a3!c16x[//16x]" then, on the next line, "[34x]" supplementary details. Value date, entry
 * (booking) date MMDD, mark D, C, RD (reversal of a debit: a credit) or RC (reversal of a credit: a debit), the funds
 * code (third letter of the currency), amount, transaction type, the owner's reference and the bank's.
 */
function statementLine(f: Field): { day: FarmDay; amount: bigint; reference: string; details: string } | null {
  const [first, ...more] = f.value.split("\n");
  const m = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,]{2,15})([NSF][A-Z0-9]{3})(.*)$/.exec(first);
  const valueDay = m && swiftDay(m[1]);
  const amount = m && swiftAmount(m[5]);
  if (!m || !valueDay || amount === null) return null;
  let day: FarmDay | null = valueDay;
  if (m[2]) {
    // The entry date has no year: the value date's, or the next or last one across a new year (value 31 Dec, entry 2 Jan).
    const [year, month] = [Number(valueDay.slice(0, 4)), Number(valueDay.slice(5, 7))];
    const entryMonth = Number(m[2].slice(0, 2));
    day = dayOf(year + (entryMonth - month > 6 ? -1 : month - entryMonth > 6 ? 1 : 0), entryMonth, Number(m[2].slice(2)));
    if (!day) return null;
  }
  const sign = m[3] === "C" || m[3] === "RD" ? 1n : -1n;
  return { day, amount: sign * amount, reference: m[7].trim().slice(0, 40), details: more.join(" ") };
}

/** The file's fields: a line starting ":tag:" opens one, other lines continue it (:61: details, :86: up to 6 × 65x). */
function fieldsOf(text: string): Field[] | number {
  const out: Field[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    // SWIFT FIN envelope ({1:…}{2:…}{4:) and the message end ("-}" or "-"): not fields.
    const line = lines[i].replace(/^\{1:.*?\{4:/, "").trimEnd();
    if (line === "" || /^-(\}|$)/.test(line) || /^\{[1-5]:/.test(line)) continue;
    const m = /^:(\d\d[A-Z]?):(.*)$/.exec(line);
    if (m) out.push({ tag: m[1], value: m[2], line: i + 1 });
    else if (out.length) out[out.length - 1].value += `\n${line}`;
    else return i + 1; // text before the first field: not an MT940 file
  }
  return out;
}

/**
 * SWIFT MT940 customer statement (published field definitions: docs/studies/bank-statement-formats.md). One message
 * per :20:. A statement split over messages ends a page on :62M: and opens the next on :60M: of the same amount; the
 * pages make one statement, ending on its :62F:. Every page must balance: opening + Σ :61: = closing.
 */
export function parseMt940(text: string): Parsed {
  const fields = fieldsOf(text);
  if (typeof fields === "number") return failAt("IMPORT_FORMAT", fields);
  const messages: Field[][] = [];
  for (const f of fields) {
    if (f.tag === "20") messages.push([]);
    else if (!messages.length) return failAt("IMPORT_FORMAT", f.line);
    messages[messages.length - 1].push(f);
  }
  if (!messages.length) return failAt("IMPORT_EMPTY", 0);

  const statements: ImportedStatement[] = [];
  let open: ImportedStatement | null = null; // a statement whose last page ended on :62M:
  for (const fs of messages) {
    const tag = (t: string) => fs.find((f) => f.tag === t);
    const account = tag("25") ?? tag("25P");
    const number = tag("28C");
    const openingField = fs.find((f) => f.tag === "60F" || f.tag === "60M");
    const closingField = fs.find((f) => f.tag === "62F" || f.tag === "62M");
    const first = fs[0]?.line ?? 0;
    if (!account || !number || !openingField || !closingField) return failAt("IMPORT_FORMAT", first);
    if (!/^\d{1,5}(\/\d{1,5})?$/.test(number.value)) return failAt("IMPORT_FIELD", number.line);
    const opening = balance(openingField);
    if (!opening.ok) return failAt(opening.error, openingField.line);
    const closing = balance(closingField);
    if (!closing.ok) return failAt(closing.error, closingField.line);

    const lines: ImportedLine[] = [];
    let last: { line: ImportedLine; details: string } | null = null;
    for (const f of fs) {
      const inside = f.line > openingField.line && f.line < closingField.line;
      if (f.tag === "61") {
        if (!inside) return failAt("IMPORT_FORMAT", f.line);
        const l = statementLine(f);
        if (!l) return failAt("IMPORT_FIELD", f.line);
        last = { line: { day: l.day, amount: l.amount, label: clean(l.details) || l.reference, reference: l.reference }, details: l.details };
        lines.push(last.line);
      } else if (f.tag === "86" && inside) {
        // :86: after a :61: describes it; the message's own :86: (after :62a:) is ignored.
        if (!last) return failAt("IMPORT_FORMAT", f.line);
        last.line.label = clean(f.value) || last.line.label;
        last = null;
      } else if (inside) return failAt("IMPORT_FORMAT", f.line);
    }
    if (opening.value.centimes + lines.reduce((s, l) => s + l.amount, 0n) !== closing.value.centimes) return failAt("IMPORT_BALANCE", closingField.line);

    const id = account.value.trim();
    if (open) {
      if (opening.value.final || open.account !== id || open.closingCentimes !== opening.value.centimes) return failAt("IMPORT_INCOMPLETE", openingField.line);
      open.lines.push(...lines);
      open.closingCentimes = closing.value.centimes;
      open.endDay = closing.value.day;
    } else {
      if (!opening.value.final) return failAt("IMPORT_INCOMPLETE", openingField.line);
      open = { account: id, number: number.value.split("/")[0], endDay: closing.value.day, openingCentimes: opening.value.centimes, closingCentimes: closing.value.centimes, lines };
    }
    if (closing.value.final) {
      statements.push(open);
      open = null;
    }
  }
  if (open) return failAt("IMPORT_INCOMPLETE", messages[messages.length - 1][0].line);
  if (new Set(statements.map((s) => s.account)).size > 1) return failAt("IMPORT_ACCOUNTS", 0);
  return { ok: true, value: statements };
}

// --- CSV with the owner's column mapping (no bank layout is assumed) ---

export const CSV_SEPARATORS = [";", ",", "\t"] as const;
export const CSV_DATE_FORMATS = ["DD/MM/YYYY", "DD-MM-YYYY", "DD.MM.YYYY", "YYYY-MM-DD", "DD/MM/YY"] as const;

/** Columns count from 1, as the owner reads them. A signed amount column, or a debit and a credit column. */
export type CsvMapping = {
  separator: (typeof CSV_SEPARATORS)[number];
  skipLines: number;
  dateColumn: number;
  dateFormat: (typeof CSV_DATE_FORMATS)[number];
  labelColumn: number;
  amountColumn: number | null;
  debitColumn: number | null;
  creditColumn: number | null;
  decimalComma: boolean;
};

/** RFC 4180 records: quoted cells may hold the separator, doubled quotes and line breaks. Each with its first line. */
export function csvRecords(text: string, separator: string): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === "\n") line++;
        cell += c;
      }
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === separator) {
      cells.push(cell);
      cell = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      out.push({ cells: [...cells, cell], line: start });
      cells = [];
      cell = "";
      start = ++line;
    } else cell += c;
  }
  if (cell !== "" || cells.length) out.push({ cells: [...cells, cell], line: start });
  return out;
}

/**
 * "1 234,56", "-1.234,56" (decimal comma) or "1,234.56" (decimal point) → signed centimes; null if not an amount.
 * A thousands separator must group 3 digits, so "50 000,00" read with a decimal point is refused, never 5 000 000.
 */
export function csvAmount(text: string, decimalComma: boolean): bigint | null {
  const plain = text.replace(/[\s  ]/g, "");
  const m = (decimalComma ? /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/ : /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/).exec(plain);
  if (!m) return null;
  const centimes = BigInt(m[2].replace(/\D/g, "")) * 100n + BigInt((m[3] ?? "").padEnd(2, "0"));
  return m[1] === "-" ? -centimes : centimes;
}

function csvDay(text: string, format: CsvMapping["dateFormat"]): FarmDay | null {
  const t = text.trim();
  const m = format === "YYYY-MM-DD" ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t) : new RegExp(`^(\\d{1,2})\\${format[2]}(\\d{1,2})\\${format[2]}(\\d{${format.length === 8 ? 2 : 4}})$`).exec(t);
  if (!m) return null;
  const [y, mo, d] = format === "YYYY-MM-DD" ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  return dayOf(y.length === 2 ? 2000 + Number(y) : Number(y), Number(mo), Number(d));
}

/**
 * A bank's spreadsheet export, read with the owner's mapping, as one statement ending on `endDay` with the closing
 * balance the owner reads on it (a CSV export carries no balance we could trust as such). Rows with an empty date cell
 * (blank rows, totals) are skipped; any other row must give a day, an amount and no day after `endDay`.
 */
export function parseCsvStatement(text: string, mapping: CsvMapping, endDay: FarmDay, closingCentimes: bigint): Parsed {
  const cell = (cells: string[], column: number | null) => (column ? (cells[column - 1] ?? "").trim() : "");
  const lines: ImportedLine[] = [];
  for (const { cells, line } of csvRecords(text, mapping.separator).slice(mapping.skipLines)) {
    if (cell(cells, mapping.dateColumn) === "") continue;
    const day = csvDay(cell(cells, mapping.dateColumn), mapping.dateFormat);
    let amount: bigint | null;
    if (mapping.amountColumn) amount = csvAmount(cell(cells, mapping.amountColumn), mapping.decimalComma);
    else {
      // Debit and credit columns: one of them filled, its sign ignored (some banks print debits negative).
      const [debit, credit] = [cell(cells, mapping.debitColumn), cell(cells, mapping.creditColumn)].map((x) => (x === "" ? 0n : csvAmount(x, mapping.decimalComma)));
      const abs = (x: bigint) => (x < 0n ? -x : x);
      amount = debit === null || credit === null ? null : abs(credit) - abs(debit);
    }
    if (!day || amount === null) return failAt("IMPORT_FIELD", line);
    if (day > endDay) return failAt("IMPORT_AFTER_END", line);
    lines.push({ day, amount, label: clean(cell(cells, mapping.labelColumn)), reference: "" });
  }
  if (!lines.length) return failAt("IMPORT_EMPTY", 0);
  return { ok: true, value: [{ account: null, number: null, endDay, openingCentimes: null, closingCentimes, lines }] };
}
