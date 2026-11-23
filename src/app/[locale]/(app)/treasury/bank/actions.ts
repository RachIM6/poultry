"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseCentimes } from "@/lib/kernel/money";
import { addBankStatement, IMPORT_MAX_BYTES, importBankFile, matchBankLine, type BankImport } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

export type BankState = { messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function addStatementAction(_: BankState, form: FormData): Promise<BankState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const text = String(form.get("closing") ?? "").trim();
  const closing = parseCentimes(text.replace(/^-/, "")); // as printed; a leading "-" when overdrawn
  if (closing === null) return { messageKey: "errors.INVALID_INPUT" };
  const treasuryId = String(form.get("treasuryId"));
  const added = await addBankStatement(ctx.value, { treasuryId, endDay: form.get("endDay"), closingCentimes: String(text.startsWith("-") ? -closing : closing) });
  if (!added.ok) return { messageKey: `errors.${added.error}` };
  const locale = form.get("locale") === "ar" ? "ar" : "fr";
  redirect(`/${locale}/treasury/bank?${new URLSearchParams({ account: treasuryId, statement: added.value })}`);
}

/** One form for the statement's lines: the pressed button names the line ("tick" or "untick"). */
export async function matchAction(_: BankState, form: FormData): Promise<BankState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const tick = form.get("tick");
  const matched = await matchBankLine(ctx.value, { statementId: form.get("statementId"), lineId: tick ?? form.get("untick"), ticked: tick !== null });
  if (!matched.ok) return { messageKey: `errors.${matched.error}` };
  refresh();
  return {};
}

export type ImportState = { messageKey?: string; values?: { line: number }; preview?: BankImport };

/**
 * T117: a statement file, previewed ("preview") or imported ("import"). The bytes go to finance, which checks size and
 * type and parses them; the size is also checked here before the file is read.
 */
export async function importAction(_: ImportState, form: FormData): Promise<ImportState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { messageKey: "errors.INVALID_INPUT" };
  if (file.size > IMPORT_MAX_BYTES) return { messageKey: "errors.IMPORT_TOO_LARGE" };
  const format = form.get("format") === "csv" ? "csv" : "mt940";
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const num = (k: string) => (text(k) === "" ? null : Number(text(k)));
  let csv = null;
  if (format === "csv") {
    const closing = parseCentimes(text("closing").replace(/^-/, ""));
    if (closing === null) return { messageKey: "errors.INVALID_INPUT" };
    const signed = form.get("amountKind") === "signed";
    csv = {
      mapping: {
        separator: text("separator") === "tab" ? "\t" : text("separator"),
        skipLines: num("skipLines") ?? 0,
        dateColumn: num("dateColumn"),
        dateFormat: text("dateFormat"),
        labelColumn: num("labelColumn"),
        amountColumn: signed ? num("amountColumn") : null,
        debitColumn: signed ? null : num("debitColumn"),
        creditColumn: signed ? null : num("creditColumn"),
        decimalComma: form.get("decimalComma") === "on",
      },
      endDay: form.get("endDay"),
      closingCentimes: String(text("closing").startsWith("-") ? -closing : closing),
    };
  }
  const treasuryId = String(form.get("treasuryId"));
  const dryRun = form.get("intent") !== "import";
  const done = await importBankFile(ctx.value, { treasuryId, format, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), csv, dryRun });
  if (!done.ok) return { messageKey: `errors.${done.error}`, values: { line: done.line ?? 0 } };
  if (dryRun) return { preview: done.value };
  const last = done.value.statements.at(-1);
  const locale = form.get("locale") === "ar" ? "ar" : "fr";
  redirect(`/${locale}/treasury/bank?${new URLSearchParams({ account: treasuryId, ...(last?.id ? { statement: last.id } : {}) })}`);
}
