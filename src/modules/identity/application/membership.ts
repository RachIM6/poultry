import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import type { Role, TenantContext } from "@/lib/tenant";
import { getSession } from "@/modules/identity/application/login";

/** ADR-006 choke point: session cookie → membership → tenant context. A signed-in user with no membership onboards. */
export async function getTenantContext(headers: Headers, clock: Clock = systemClock): Promise<Result<TenantContext, "UNAUTHENTICATED" | "NO_MEMBERSHIP">> {
  const session = await getSession(headers);
  if (!session) return fail("UNAUTHENTICATED");
  // ponytail: the oldest membership wins; add an organisation switcher once someone belongs to two (vet, accountant: M5).
  // SPEC-m5 PA3: a partner's membership opens the organisation up to its end day, included.
  const live = { OR: [{ accessUntil: null }, { accessUntil: { gte: new Date(`${farmDayOf(clock.now())}T00:00:00Z`) } }] };
  const membership = await db.membership.findFirst({ where: { userId: session.userId, ...live }, orderBy: { createdAt: "asc" } });
  if (!membership) return fail("NO_MEMBERSHIP");
  return ok({ userId: session.userId, organizationId: membership.organizationId, role: membership.role });
}

/** Each user's language (SPEC I3), for messages sent outside a request: push notifications. */
export async function localesOf(userIds: string[]): Promise<Map<string, "ar" | "fr">> {
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, locale: true } });
  return new Map(users.map((u) => [u.id, u.locale]));
}

/**
 * Locks the user row for the rest of the transaction, so two onboarding submits run one after the other.
 * True when the user has no organisation yet.
 */
export async function lockForOnboarding(tx: Tx, userId: string): Promise<boolean> {
  await tx.$executeRaw`SELECT 1 FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
  return (await tx.membership.count({ where: { userId } })) === 0;
}

/** Onboarding (poultry-auth §0.2): the user who creates the organisation owns it. SPEC I3: their language is saved. */
export async function addOwner(tx: Tx, input: { organizationId: string; userId: string; locale: "ar" | "fr" }) {
  const { organizationId, userId, locale } = input;
  const membership = await tx.membership.create({ data: { organizationId, userId, role: "owner" } });
  await tx.user.update({ where: { id: userId }, data: { locale } });
  await tx.auditEvent.create({
    data: { organizationId, userId, entity: "Membership", entityId: membership.id, action: "create", after: { userId, role: "owner" } },
  });
}

/** The members of an organisation who hold one of these roles, e.g. to notify owners and managers (SPEC N3). */
export async function membersWithRoles(tx: Tx, organizationId: string, roles: Role[]): Promise<string[]> {
  const rows = await tx.membership.findMany({ where: { organizationId, role: { in: roles } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** The member of an organisation who signs in with this number (E.164), or null: links an employee to a user (SPEC-m4 WF2). */
export async function memberByPhone(tx: Tx, organizationId: string, e164: string): Promise<string | null> {
  const row = await tx.membership.findFirst({ where: { organizationId, user: { phoneNumber: e164 } }, select: { userId: true } });
  return row?.userId ?? null;
}
