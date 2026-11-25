import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import type { Role, TenantContext } from "@/lib/tenant";
import { getSession } from "@/modules/identity/application/session";
import { PARTNER_ROLES, SaveLocale } from "@/modules/identity/schema";

/** SPEC-m5 PA2 (ADR-013): the organisation the user chose. Only a hint: it opens nothing unless it is a live membership. */
export const ORG_COOKIE = "__Host-org";
const chosenOrganization = (headers: Headers) =>
  headers.get("cookie")?.split(";").map((c) => c.trim().split("=")).find(([k]) => k === ORG_COOKIE)?.[1];

// SPEC-m5 PA3: a partner's membership opens the organisation up to its end day, included.
const live = (clock: Clock) => ({ OR: [{ accessUntil: null }, { accessUntil: { gte: new Date(`${farmDayOf(clock.now())}T00:00:00Z`) } }] });
const liveMemberships = (userId: string, clock: Clock) =>
  db.membership.findMany({ where: { userId, ...live(clock) }, orderBy: { createdAt: "asc" }, include: { organization: { select: { name: true, leftAt: true } } } });
/** The membership a request opens: the chosen organisation when it is a live membership, else the oldest. */
const opened = <M extends { organizationId: string }>(memberships: M[], headers: Headers) => memberships.find((m) => m.organizationId === chosenOrganization(headers)) ?? memberships[0];
const openedMembership = async (userId: string, headers: Headers, clock: Clock) => opened(await liveMemberships(userId, clock), headers);

/**
 * ADR-006 choke point: session cookie → membership → tenant context. A signed-in user with no membership onboards.
 * With several memberships: the chosen organisation when it is one of them, else the oldest.
 */
export async function getTenantContext(headers: Headers, clock: Clock = systemClock): Promise<Result<TenantContext, "UNAUTHENTICATED" | "NO_MEMBERSHIP">> {
  const session = await getSession(headers);
  if (!session) return fail("UNAUTHENTICATED");
  const membership = await openedMembership(session.userId, headers, clock);
  if (!membership) return fail("NO_MEMBERSHIP");
  const { leftAt } = membership.organization; // docs/data-requests.md: read-only once it left the platform
  return ok({ userId: session.userId, organizationId: membership.organizationId, role: membership.role, ...(leftAt && { leftAt: leftAt.toISOString() }) });
}

/**
 * The tenant context of a server action or a write route handler: refused once the organisation left the platform, so
 * its 30 days before deletion are read-only (docs/data-requests.md). Sync pushes refuse each mutation instead
 * (lib/sync/server.ts), so the phone lists what was refused.
 */
export async function getWriteContext(headers: Headers, clock: Clock = systemClock): Promise<Result<TenantContext, "UNAUTHENTICATED" | "ORGANIZATION_LEFT">> {
  const ctx = await getTenantContext(headers, clock);
  if (!ctx.ok) return fail("UNAUTHENTICATED");
  return ctx.value.leftAt ? fail("ORGANIZATION_LEFT") : ctx;
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
  const [memberships, invitations] = await Promise.all([
    liveMemberships(session.userId, clock),
    session.phone ? db.invitation.findMany({ where: { phoneNumber: session.phone, expiresAt: { gt: clock.now() }, organization: { leftAt: null } }, include: { organization: { select: { name: true } } }, orderBy: { createdAt: "asc" } }) : [],
  ]);
  return ok({
    current: opened(memberships, headers)?.organizationId ?? null, // the one getTenantContext opens
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

/**
 * SPEC-m5 PA6: a partner's sign-in opens the organisation getTenantContext will open (the chosen one, else the oldest),
 * and that organisation's audit log gets the same `Membership/open` as a switch (chooseOrganization). Once, at login:
 * the session then stays in it until a switch, which is audited there.
 */
export async function auditPartnerSignIn(userId: string, headers: Headers, clock: Clock = systemClock) {
  const membership = await openedMembership(userId, headers, clock);
  if (!membership || !PARTNER_ROLES.includes(membership.role)) return;
  await db.auditEvent.create({ data: { organizationId: membership.organizationId, userId, entity: "Membership", entityId: membership.id, action: "open", after: { role: membership.role, signIn: true } } });
}

/** SPEC-m5 PA2: a signed-in user accepts an invitation sent to their own phone; returns the organisation it opens. */
export async function acceptInvitation(headers: Headers, invitationId: string, clock: Clock = systemClock): Promise<Result<string, "UNAUTHENTICATED" | "NOT_FOUND">> {
  const session = await getSession(headers);
  if (!session?.phone) return fail("UNAUTHENTICATED");
  const phone = session.phone;
  return db.$transaction(async (tx) => {
    const inv = await tx.invitation.findFirst({ where: { id: invitationId, phoneNumber: phone, expiresAt: { gt: clock.now() }, organization: { leftAt: null } } });
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

/**
 * The live memberships of these users (a partner's up to its end day), as "organizationId:userId" → role: who may still
 * get a push from an organisation, and whether it may show money.
 */
export async function liveRoles(userIds: string[], clock: Clock = systemClock): Promise<Map<string, Role>> {
  const rows = await db.membership.findMany({ where: { userId: { in: userIds }, ...live(clock) }, select: { organizationId: true, userId: true, role: true } });
  return new Map(rows.map((m) => [`${m.organizationId}:${m.userId}`, m.role]));
}

/** Each user's language (SPEC I3), for messages sent outside a request: push notifications. */
export async function localesOf(userIds: string[]): Promise<Map<string, "ar" | "fr">> {
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, locale: true } });
  return new Map(users.map((u) => [u.id, u.locale]));
}

/** SPEC I3: the language picked in the switcher is saved on the user, so pushes and the inbox follow it. */
export async function saveLocale(userId: string, input: unknown): Promise<Result<void, "INVALID_INPUT">> {
  const parsed = SaveLocale.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  await db.user.update({ where: { id: userId }, data: { locale: parsed.data.locale } });
  return ok(undefined);
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
