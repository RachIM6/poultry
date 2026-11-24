import { v7 as uuidv7 } from "uuid";
import { audit } from "@/lib/audit";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, nextFarmDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { postEntry, type PostError } from "@/modules/finance/application/ledger";
import { atomically } from "@/modules/finance/application/placements";
import { associatePosting, ownerAccountOf } from "@/modules/finance/domain/contribution";
import type { TreasuryKind } from "@/modules/finance/domain/treasury";
import { sourceAlreadyPosted } from "@/modules/finance/infrastructure/ledger";
import { AssociateMovement } from "@/modules/finance/schema";

// SPEC-finance FN6, FQ11 (§9 "Associate contributions"): the owner records money an associate (4463) or the individual
// exploitant (1117) brings into, or takes out of, a cash box or bank account.

export type AssociateMovementError = PostError | "INVALID_INPUT" | "DAY_IN_FUTURE";

const inFuture = (day: string, clock: Clock) => daysBetween(day as FarmDay, nextFarmDay(farmDayOf(clock.now()))) < 0;

/** Which account the organisation's contributions and withdrawals go on, and whether its owner is an individual exploitant. */
export async function associateAccount(ctx: TenantContext): Promise<Result<{ account: string; individual: boolean }, "FORBIDDEN" | "NOT_FOUND">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  const individual = entity.form === "individual";
  return ok({ account: ownerAccountOf(individual), individual });
}

/**
 * A contribution (D 5141 / 5161 / C the owner's account) or a withdrawal (the reverse), on its day, from or into one
 * of the organisation's cash boxes or bank accounts. Online, the owner only, audited; the id comes from the form (the
 * same form twice posts once, source `associate:<id>`). A locked month refuses it (FN5). Every legal form posts it,
 * `cash_book` too: the money moves on 51xx, so it shows in its cash book.
 */
export async function recordAssociateMovement(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, AssociateMovementError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = AssociateMovement.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const m = parsed.data;
  if (inFuture(m.day, clock)) return fail("DAY_IN_FUTURE");
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  const source = { module: "finance", id: `associate:${m.id}`, version: 1 };
  return atomically(async (tx): Promise<Result<void, AssociateMovementError>> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${source.id}, 8))`; // the same form sent twice at once
    if (await sourceAlreadyPosted(tx, ctx, source)) return ok(undefined); // a retry
    const treasury = await tx.treasuryAccount.findFirst({ where: { id: m.treasuryId, organizationId: ctx.organizationId }, select: { id: true, kind: true } });
    if (!treasury) return fail("NOT_FOUND");
    const individual = entity.form === "individual";
    const posting = associatePosting({ direction: m.direction, amount: BigInt(m.amountCentimes), treasury: { id: treasury.id, kind: treasury.kind as TreasuryKind }, individual, associate: m.associate });
    const posted = await postEntry(tx, ctx, { id: uuidv7(), legalEntityId: entity.id, journal: posting.journal, day: m.day as FarmDay, label: posting.label, reversesId: null, lines: posting.lines, source });
    if (!posted.ok) return posted;
    await audit(tx, ctx, { entity: "AssociateAccount", entityId: m.id, action: m.direction, after: { ...m, account: ownerAccountOf(individual) } });
    return ok(undefined);
  });
}
