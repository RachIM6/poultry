import { db, type Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import type { TenantContext } from "@/lib/tenant";
import { getSession } from "@/modules/identity/application/login";

/** ADR-006 choke point: session cookie → membership → tenant context. A signed-in user with no membership onboards. */
export async function getTenantContext(headers: Headers): Promise<Result<TenantContext, "UNAUTHENTICATED" | "NO_MEMBERSHIP">> {
  const session = await getSession(headers);
  if (!session) return fail("UNAUTHENTICATED");
  // ponytail: the oldest membership wins; add an organisation switcher once someone belongs to two (vet, accountant: M5).
  const membership = await db.membership.findFirst({ where: { userId: session.userId }, orderBy: { createdAt: "asc" } });
  if (!membership) return fail("NO_MEMBERSHIP");
  return ok({ userId: session.userId, organizationId: membership.organizationId, role: membership.role });
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
