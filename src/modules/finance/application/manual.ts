import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { postEntry, type PostError } from "@/modules/finance/application/ledger";
import { ManualEntryInput } from "@/modules/finance/schema";

export type ManualEntryError = PostError | "INVALID_INPUT" | "DAY_IN_FUTURE" | "CASH_BOOK_NO_MANUAL_ENTRY";

/**
 * SPEC-finance FCX3: an `OD` entry the owner types, on any posting account of the entity's chart, also the first
 * year's opening balances (FN3). Posted through `postEntry` (FN4 checks, audit), source `finance:<id>`: the same id
 * twice posts once. Dated by its author: a locked month refuses it, it is never moved (unlike FN5 corrections).
 * A `cash_book` entity has none: the counter-account of its opening bank and cash balances waits for FQ11.
 */
export async function postManualEntry(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, ManualEntryError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = ManualEntryInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const e = parsed.data;
  const day = e.day as FarmDay;
  if (daysBetween(day, nextFarmDay(farmDayOf(clock.now()))) < 0) return fail("DAY_IN_FUTURE");
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1
  if (!entity) return fail("NOT_FOUND");
  if (entity.accountingProfile.books !== "ledger") return fail("CASH_BOOK_NO_MANUAL_ENTRY");
  const lines = e.lines.map((l) => ({ account: l.account, debit: BigInt(l.debit), credit: BigInt(l.credit) }));
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
export async function attachManualEntryReceipt(ctx: TenantContext, entryId: string, fileId: string): Promise<Result<void>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  return db.$transaction(async (tx) => {
    // Conditional update: of two uploads at once, only the first attaches.
    const { count } = await tx.manualEntry.updateMany({ where: { id: entryId, organizationId: ctx.organizationId, receiptFileId: null }, data: { receiptFileId: fileId } });
    if (count === 0) return (await tx.manualEntry.count({ where: { id: entryId, organizationId: ctx.organizationId } })) ? fail("FILE_ALREADY_ATTACHED") : fail("NOT_FOUND");
    await audit(tx, ctx, { entity: "ManualEntry", entityId: entryId, action: "update", before: { receiptFileId: null }, after: { receiptFileId: fileId } });
    return ok(undefined);
  });
}
