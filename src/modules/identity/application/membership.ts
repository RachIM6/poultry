import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import type { Role, TenantContext } from "@/lib/tenant";
import { getSession } from "@/modules/identity/application/login";

/** SPEC-m5 PA2 (ADR-013): the organisation the user chose. Only a hint: it opens nothing unless it is a live membership. */
export const ORG_COOKIE = "__Host-org";
const chosenOrganization = (headers: Headers) =>
  headers.get("cookie")?.split(";").map((c) => c.trim().split("=")).find(([k]) => k === ORG_COOKIE)?.[1];

// SPEC-m5 PA3: a partner's membership opens the organisation up to its end day, included.
const live = (clock: Clock) => ({ OR: [{ accessUntil: null }, { accessUntil: { gte: new Date(`${farmDayOf(clock.now())}T00:00:00Z`) } }] });
const liveMemberships = (userId: string, clock: Clock) =>
  db.membership.findMany({ where: { userId, ...live(clock) }, orderBy: { createdAt: "asc" }, include: { organization: { select: { name: true } } } });

/**
 * ADR-006 choke point: session cookie → membership → tenant context. A signed-in user with no membership onboards.
 * With several memberships: the chosen organisation when it is one of them, else the oldest.
 */
export async function getTenantContext(headers: Headers, clock: Clock = systemClock): Promise<Result<TenantContext, "UNAUTHENTICATED" | "NO_MEMBERSHIP">> {
  const session = await getSession(headers);
  if (!session) return fail("UNAUTHENTICATED");
  const memberships = await liveMemberships(session.userId, clock);
  const chosen = chosenOrganization(headers);
  const membership = memberships.find((m) => m.organizationId === chosen) ?? memberships[0];
  if (!membership) return fail("NO_MEMBERSHIP");
  return ok({ userId: session.userId, organizationId: membership.organizationId, role: membership.role });
}

export type MyOrganizations = {
  current: string | null;
  memberships: { organizationId: string; name: string; role: Role; accessUntil: string | null }[];
  invitations: { id: string; organizationId: string; name: string; role: Role }[]; // pending, for this user's phone
};

/** SPEC-m5 PA2: the farms this user can open, and the invitations waiting for them (a partner already elsewhere). */
export async function myOrganizations(headers: Headers, clock: Clock = systemClock): Promise<Result<MyOrganizations, "UNAUTHENTICATED">> {
  const session = await getSession(headers);
  if (!session) return fail("UNAUTHENTICATED");
  const [memberships, invitations, ctx] = await Promise.all([
    liveMemberships(session.userId, clock),
    session.phone ? db.invitation.findMany({ where: { phoneNumber: session.phone, expiresAt: { gt: clock.now() } }, include: { organization: { select: { name: true } } }, orderBy: { createdAt: "asc" } }) : [],
    getTenantContext(headers, clock),
  ]);
  return ok({
    current: ctx.ok ? ctx.value.organizationId : null,
    memberships: memberships.map((m) => ({ organizationId: m.organizationId, name: m.organization.name, role: m.role, accessUntil: m.accessUntil && m.accessUntil.toISOString().slice(0, 10) })),
    invitations: invitations
      .filter((i) => !memberships.some((m) => m.organizationId === i.organizationId))
      .map((i) => ({ id: i.id, organizationId: i.organizationId, name: i.organization.name, role: i.role })),
  });
}

/** SPEC-m5 PA2, PA6: checks the user may open this organisation, and audits it. The caller sets ORG_COOKIE. */
export async function chooseOrganization(headers: Headers, organizationId: string, clock: Clock = systemClock): Promise<Result<void, "UNAUTHENTICATED" | "NOT_FOUND">> {
  const session = await getSession(headers);
  if (!session) return fail("UNAUTHENTICATED");
  const membership = (await liveMemberships(session.userId, clock)).find((m) => m.organizationId === organizationId);
  if (!membership) return fail("NOT_FOUND");
  await db.auditEvent.create({ data: { organizationId, userId: session.userId, entity: "Membership", entityId: membership.id, action: "open", after: { role: membership.role } } });
  return ok(undefined);
}

/** SPEC-m5 PA2: a signed-in user accepts an invitation sent to their own phone; returns the organisation it opens. */
export async function acceptInvitation(headers: Headers, invitationId: string, clock: Clock = systemClock): Promise<Result<string, "UNAUTHENTICATED" | "NOT_FOUND">> {
  const session = await getSession(headers);
  if (!session?.phone) return fail("UNAUTHENTICATED");
  const phone = session.phone;
  return db.$transaction(async (tx) => {
    const inv = await tx.invitation.findFirst({ where: { id: invitationId, phoneNumber: phone, expiresAt: { gt: clock.now() } } });
    if (!inv) return fail("NOT_FOUND");
    const membership = await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId: session.userId } },
      create: { organizationId: inv.organizationId, userId: session.userId, role: inv.role, accessUntil: inv.accessUntil },
      update: {}, // already a member: keep the current role
    });
    await tx.invitation.delete({ where: { id: inv.id } });
    await tx.auditEvent.create({
      data: { organizationId: inv.organizationId, userId: session.userId, entity: "Invitation", entityId: inv.id, action: "accept", after: { membershipId: membership.id, role: membership.role } },
    });
    return ok(inv.organizationId);
  });
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
