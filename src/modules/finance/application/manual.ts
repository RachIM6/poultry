import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, latestRecordableDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { postEntry, type PostError } from "@/modules/finance/application/ledger";
import { cashBookAccount } from "@/modules/finance/domain/contribution";
import { treasuryKindOfAccount } from "@/modules/finance/domain/treasury";
import { ManualEntryInput } from "@/modules/finance/schema";

export type ManualEntryError = PostError | "INVALID_INPUT" | "DAY_IN_FUTURE" | "CASH_BOOK_NO_MANUAL_ENTRY" | "TREASURY_ACCOUNT_REQUIRED" | "TREASURY_ACCOUNT_MISMATCH";

/**
 * SPEC-finance FCX3: an `OD` entry the owner types, on any posting account of the entity's chart, also the first
 * year's opening balances (FN3). Posted through `postEntry` (FN4 checks, audit), source `finance:<id>`: the same id
 * twice posts once. Dated by its author: a locked month refuses it, it is never moved (unlike FN5 corrections).
 * A `cash_book` entity has no balance sheet: its entry carries only its opening bank and cash balances (5141, 5161),
 * against 1117 Capital personnel for an individual exploitant, 4463 for any other legal form (FN3, FQ11).
 */
export async function postManualEntry(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, ManualEntryError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = ManualEntryInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const e = parsed.data;
  const day = e.day as FarmDay;
  if (daysBetween(day, latestRecordableDay(clock)) < 0) return fail("DAY_IN_FUTURE");
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1
  if (!entity) return fail("NOT_FOUND");
  if (entity.accountingProfile.books !== "ledger" && !e.lines.every((l) => cashBookAccount(l.account, entity.form === "individual"))) return fail("CASH_BOOK_NO_MANUAL_ENTRY");
  // FN3, FN10, FC9: a 5141 line names one of the organisation's bank accounts, a 5161 line a cash box, like every
  // other posting, so the balance per account and the bank reconciliation see it (an opening bank balance, FCX3).
  const named = e.lines.flatMap((l) => (l.treasuryId ? [l.treasuryId] : []));
  const kinds = new Map((await db.treasuryAccount.findMany({ where: { id: { in: named }, organizationId: ctx.organizationId }, select: { id: true, kind: true } })).map((a) => [a.id, a.kind]));
  for (const l of e.lines) {
    const kind = treasuryKindOfAccount(l.account);
    if (!kind) {
      if (l.treasuryId) return fail("INVALID_INPUT");
      continue;
    }
    if (!l.treasuryId) return fail("TREASURY_ACCOUNT_REQUIRED");
    if (!kinds.has(l.treasuryId)) return fail("NOT_FOUND"); // another organisation's
    if (kinds.get(l.treasuryId) !== kind) return fail("TREASURY_ACCOUNT_MISMATCH");
  }
  const lines = e.lines.map((l) => ({ account: l.account, debit: BigInt(l.debit), credit: BigInt(l.credit), treasuryId: l.treasuryId }));
  const retry = (prior: { organizationId: string } | null) => (prior?.organizationId === ctx.organizationId ? ok(undefined) : fail("ALREADY_EXISTS"));
  return db.$transaction(async (tx) => {
    const prior = await tx.manualEntry.findUnique({ where: { id: e.id }, select: { organizationId: true } });
    if (prior) return retry(prior); // a retry
    const posted = await postEntry(tx, ctx, { id: e.id, legalEntityId: entity.id, journal: "OD", day, label: e.label, reversesId: null, lines, source: { module: "finance", id: e.id, version: 1 } });
    if (!posted.ok) return posted;
    await tx.manualEntry.create({ data: { id: e.id, organizationId: ctx.organizationId, piece: e.piece, createdBy: ctx.userId } });
    await audit(tx, ctx, { entity: "ManualEntry", entityId: e.id, action: "create", after: { piece: e.piece } }); // the lines: postEntry's audit
    return ok(undefined);
  }).catch(async (err) => {
    // Two submits of the same form at once: the second's insert hits the first's key once it commits. A retry too.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    return retry(await db.manualEntry.findUnique({ where: { id: e.id }, select: { organizationId: true } }));
  });
}

/** ADR-011: the receipt the upload route has just stored, attached once to the owner's manual entry. */
export async function attachManualEntryReceipt(ctx: TenantContext, entryId: string, fileId: string, inTx?: Tx): Promise<Result<void>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const attach = async (tx: Tx) => {
    // Conditional update: of two uploads at once, only the first attaches.
    const { count } = await tx.manualEntry.updateMany({ where: { id: entryId, organizationId: ctx.organizationId, receiptFileId: null }, data: { receiptFileId: fileId } });
    if (count === 0) return (await tx.manualEntry.count({ where: { id: entryId, organizationId: ctx.organizationId } })) ? fail("FILE_ALREADY_ATTACHED") : fail("NOT_FOUND");
    await audit(tx, ctx, { entity: "ManualEntry", entityId: entryId, action: "update", before: { receiptFileId: null }, after: { receiptFileId: fileId } });
    return ok(undefined);
  };
  return inTx ? attach(inTx) : db.$transaction(attach); // inTx: the upload's own transaction
}
