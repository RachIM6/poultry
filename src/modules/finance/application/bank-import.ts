import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { parseCsvStatement, parseMt940, type ImportedStatement, type ImportError } from "@/modules/finance/domain/bank-import";
import { bankAccountsOf, importedHashesOf, saveImportedLines, saveStatement, statementOn } from "@/modules/finance/infrastructure/bank";
import { ImportBankFile } from "@/modules/finance/schema";

// SPEC-finance FC9, T117: a bank statement file imported onto a bank account, online, by the owner or a manager
// (finance.record, like the manual statement). The file is untrusted data: size and name checked, decoded as text,
// parsed field by field (domain/bank-import.ts), never executed or stored as it came. Its lines then wait on the
// statement for T111's ticks (pairImported).

/** Below Next's 1 MB server-action body limit. A month of MT940 for one account is a few kilobytes. */
export const IMPORT_MAX_BYTES = 512 * 1024;
const EXTENSIONS = { mt940: [".sta", ".mt940", ".940", ".fin", ".txt"], csv: [".csv", ".txt"] } as const;
const PREVIEW_LINES = 20;

type Code = ImportError | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "DAY_IN_FUTURE" | "IMPORT_TOO_LARGE" | "IMPORT_FILE_TYPE" | "IMPORT_CONFLICT";
export type ImportFailure = { ok: false; error: Code; line?: number };
export type BankImport = {
  dryRun: boolean;
  statements: {
    id: string | null; // null in a preview of a new statement
    endDay: string;
    openingCentimes: string | null; // MT940 only
    closingCentimes: string;
    lineCount: number;
    added: number; // 0 when the statement's lines are already there
    lines: { day: string; label: string; amountCentimes: string }[]; // the first ones, for the preview
  }[];
};

const failure = (error: Code): ImportFailure => ({ ok: false, error });

/** The file's text: UTF-8 (a BOM dropped), else Windows-1252, as French-language exports often are. Binary is refused. */
function textOf(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Each line's key on its statement: a hash of what the bank printed, plus its rank among identical lines (two equal fees). */
function rowsOf(s: ImportedStatement) {
  const seen = new Map<string, number>();
  return s.lines.map((l) => {
    const printed = `${l.day}|${l.amount}|${l.reference}|${l.label}`;
    const rank = (seen.get(printed) ?? 0) + 1;
    seen.set(printed, rank);
    return { id: uuidv7(), day: l.day, amountCentimes: l.amount, label: l.label, reference: l.reference, hash: createHash("sha256").update(`${printed}|${rank}`).digest("hex") };
  });
}

/**
 * Reads the file and, unless `dryRun`, saves each statement in it: a statement is the account's statement of that end
 * day (one per day, T111), created if missing, and its lines are added once. Importing the same file again adds
 * nothing. A statement already there with another closing balance, or with other imported lines, refuses the whole
 * file (IMPORT_CONFLICT): nothing is saved.
 */
export async function importBankFile(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<{ ok: true; value: BankImport } | ImportFailure> {
  if (!can(ctx, "finance.record")) return failure("FORBIDDEN");
  const parsed = ImportBankFile.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT");
  const { treasuryId, format, fileName, bytes, csv, dryRun } = parsed.data;
  if (bytes.byteLength > IMPORT_MAX_BYTES) return failure("IMPORT_TOO_LARGE");
  if (!EXTENSIONS[format].some((e) => fileName.toLowerCase().endsWith(e))) return failure("IMPORT_FILE_TYPE");
  const text = textOf(bytes);
  if (text === null) return failure("IMPORT_FILE_TYPE");
  const read = csv ? parseCsvStatement(text, csv.mapping, csv.endDay as FarmDay, BigInt(csv.closingCentimes)) : parseMt940(text);
  if (!read.ok) return { ok: false, error: read.error, line: read.line };
  const today = farmDayOf(clock.now());
  if (read.value.some((s) => s.endDay > today)) return failure("DAY_IN_FUTURE");

  try {
    return await db.$transaction((tx) => save(tx, ctx, treasuryId, format, fileName, read.value, dryRun));
  } catch (e) {
    if (e === CREATED_MEANWHILE) return failure("IMPORT_CONFLICT"); // rolled back
    throw e;
  }
}

const CREATED_MEANWHILE = Symbol("statement created meanwhile");

async function save(tx: Tx, ctx: TenantContext, treasuryId: string, format: string, fileName: string, read: ImportedStatement[], dryRun: boolean): Promise<{ ok: true; value: BankImport } | ImportFailure> {
  if (!(await bankAccountsOf(tx, ctx)).some((a) => a.id === treasuryId)) return failure("NOT_FOUND"); // a cash box, or another organisation's
  // Every check before any write, so a refused file saves nothing.
  const plan = [];
  for (const s of read) {
    const rows = rowsOf(s);
    const existing = await statementOn(tx, ctx, treasuryId, s.endDay);
    const stored = existing ? new Set(await importedHashesOf(tx, ctx, existing.id)) : new Set<string>();
    if (existing && existing.closingCentimes !== s.closingCentimes) return failure("IMPORT_CONFLICT");
    if (stored.size && (stored.size !== rows.length || rows.some((r) => !stored.has(r.hash)))) return failure("IMPORT_CONFLICT");
    plan.push({ s, rows, existing, fresh: stored.size === 0 });
  }

  const statements: BankImport["statements"] = [];
  for (const { s, rows, existing, fresh } of plan) {
    let id = existing?.id ?? null;
    let added = fresh ? rows.length : 0;
    if (!dryRun) {
      if (!id) {
        id = uuidv7();
        if (!(await saveStatement(tx, ctx, { id, treasuryId, endDay: s.endDay, closingCentimes: s.closingCentimes }))) throw CREATED_MEANWHILE; // by another import: undo this one
      }
      added = fresh ? await saveImportedLines(tx, ctx, id, rows) : 0;
      if (!existing || added) await audit(tx, ctx, { entity: "BankStatement", entityId: id, action: "import", after: { treasuryId, format, fileName, endDay: s.endDay, closingCentimes: String(s.closingCentimes), created: !existing, lines: added } });
    }
    statements.push({
      id,
      endDay: s.endDay,
      openingCentimes: s.openingCentimes === null ? null : String(s.openingCentimes),
      closingCentimes: String(s.closingCentimes),
      lineCount: rows.length,
      added,
      lines: s.lines.slice(0, PREVIEW_LINES).map((l) => ({ day: l.day, label: l.label, amountCentimes: String(l.amount) })),
    });
  }
  return { ok: true, value: { dryRun, statements } };
}
