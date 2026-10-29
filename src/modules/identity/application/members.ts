import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import { consume } from "@/lib/security/rate-limit";
import type { Role, TenantContext } from "@/lib/tenant";
import { PhoneNumber } from "@/modules/identity/domain/phone-number";
import { AUTH_CONFIG } from "@/modules/identity/infrastructure/better-auth";
import { CancelInvitation, ChangeRole, InviteMember, RemoveMember } from "@/modules/identity/schema";

type MemberError = "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "LAST_OWNER";

export type MembersDto = {
  members: { membershipId: string; userId: string; phone: string | null; role: Role }[];
  invitations: { id: string; phone: string; role: Role; expiresAt: Date }[];
};

/** SPEC I4. Owner only. Inviting again replaces the pending invitation (new role, new expiry). No SMS is sent. */
export async function inviteMember(
  ctx: TenantContext,
  raw: unknown,
  clock: Clock = systemClock,
): Promise<Result<void, "FORBIDDEN" | "INVALID_INPUT" | "INVALID_PHONE" | "ALREADY_MEMBER" | "TOO_MANY_REQUESTS">> {
  if (!can(ctx, "members.manage")) return fail("FORBIDDEN");
  const input = InviteMember.safeParse(raw);
  if (!input.success) return fail("INVALID_INPUT");
  const phone = PhoneNumber.create(input.data.phone);
  if (!phone.ok) return phone;
  if ((await consume("inviteMember", { phone: phone.value.e164, user: ctx.userId })).length > 0) return fail("TOO_MANY_REQUESTS");

  const { organizationId } = ctx;
  const phoneNumber = phone.value.e164;
  return db.$transaction(async (tx) => {
    const member = await tx.membership.findFirst({ where: { organizationId, user: { phoneNumber } } });
    if (member) return fail("ALREADY_MEMBER");
    const expiresAt = new Date(clock.now().getTime() + AUTH_CONFIG.invitation.expiresInSec * 1000);
    const data = { role: input.data.role, invitedById: ctx.userId, expiresAt };
    const invitation = await tx.invitation.upsert({
      where: { organizationId_phoneNumber: { organizationId, phoneNumber } },
      create: { organizationId, phoneNumber, ...data },
      update: data,
    });
    await audit(tx, ctx, "Invitation", invitation.id, "create", null, { phone: phone.value.masked, role: input.data.role });
    return ok(undefined);
  });
}

/** Members and pending invitations of the caller's organisation. Owner only. */
export async function listMembers(ctx: TenantContext, clock: Clock = systemClock): Promise<Result<MembersDto, "FORBIDDEN">> {
  if (!can(ctx, "members.manage")) return fail("FORBIDDEN");
  const [members, invitations] = await Promise.all([
    db.membership.findMany({
      where: { organizationId: ctx.organizationId },
      include: { user: { select: { phoneNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { organizationId: ctx.organizationId, expiresAt: { gt: clock.now() } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return ok({
    members: members.map((m) => ({ membershipId: m.id, userId: m.userId, phone: m.user.phoneNumber, role: m.role })),
    invitations: invitations.map((i) => ({ id: i.id, phone: i.phoneNumber, role: i.role, expiresAt: i.expiresAt })),
  });
}

/** Owner only. Logs the member out everywhere: their next online request gets 401 and re-reads the role (poultry-auth §0.3). */
export async function changeRole(ctx: TenantContext, raw: unknown): Promise<Result<void, MemberError>> {
  if (!can(ctx, "members.manage")) return fail("FORBIDDEN");
  const input = ChangeRole.safeParse(raw);
  if (!input.success) return fail("INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const member = await lockMember(tx, ctx, input.data.membershipId);
    if (!member.ok) return member;
    const { id, userId, role, isLastOwner } = member.value;
    if (role === input.data.role) return ok(undefined);
    if (isLastOwner) return fail("LAST_OWNER");
    await tx.membership.update({ where: { id }, data: { role: input.data.role } });
    await revokeSessions(tx, ctx, userId);
    await audit(tx, ctx, "Membership", id, "update", { role }, { role: input.data.role });
    return ok(undefined);
  });
}

/** Owner only. The member's devices are logged out at their next online request. */
export async function removeMember(ctx: TenantContext, raw: unknown): Promise<Result<void, MemberError>> {
  if (!can(ctx, "members.manage")) return fail("FORBIDDEN");
  const input = RemoveMember.safeParse(raw);
  if (!input.success) return fail("INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const member = await lockMember(tx, ctx, input.data.membershipId);
    if (!member.ok) return member;
    const { id, userId, role, isLastOwner } = member.value;
    if (isLastOwner) return fail("LAST_OWNER");
    await tx.membership.delete({ where: { id } });
    await revokeSessions(tx, ctx, userId);
    await audit(tx, ctx, "Membership", id, "delete", { userId, role }, null);
    return ok(undefined);
  });
}

export async function cancelInvitation(ctx: TenantContext, raw: unknown): Promise<Result<void, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  if (!can(ctx, "members.manage")) return fail("FORBIDDEN");
  const input = CancelInvitation.safeParse(raw);
  if (!input.success) return fail("INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const { count } = await tx.invitation.deleteMany({ where: { id: input.data.invitationId, organizationId: ctx.organizationId } });
    if (count === 0) return fail("NOT_FOUND");
    await audit(tx, ctx, "Invitation", input.data.invitationId, "delete", null, null);
    return ok(undefined);
  });
}

/** At login: every pending, unexpired invitation for this number becomes a membership (poultry-auth §1). */
export async function acceptInvitations(userId: string, phoneNumber: string, clock: Clock = systemClock) {
  await db.$transaction(async (tx) => {
    const pending = await tx.invitation.findMany({ where: { phoneNumber, expiresAt: { gt: clock.now() } } });
    for (const inv of pending) {
      const membership = await tx.membership.upsert({
        where: { organizationId_userId: { organizationId: inv.organizationId, userId } },
        create: { organizationId: inv.organizationId, userId, role: inv.role },
        update: {}, // already a member: keep the current role
      });
      await tx.invitation.delete({ where: { id: inv.id } });
      const ctx = { userId, organizationId: inv.organizationId };
      await audit(tx, ctx, "Invitation", inv.id, "accept", null, { membershipId: membership.id, role: membership.role });
    }
  });
}

/**
 * Finds the membership in the caller's organisation (NOT_FOUND for another organisation's) after locking the
 * organisation's memberships, so two owners demoting each other at once can't leave it without an owner.
 */
async function lockMember(tx: Tx, ctx: TenantContext, membershipId: string) {
  const rows = await tx.$queryRaw<{ id: string; userId: string; role: Role }[]>`
    SELECT id, "userId", role FROM "Membership" WHERE "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
  const member = rows.find((m) => m.id === membershipId);
  if (!member) return fail("NOT_FOUND");
  // Demoting or removing the only owner would leave nobody able to manage members.
  const isLastOwner = member.role === "owner" && rows.filter((m) => m.role === "owner").length === 1;
  return ok({ ...member, isLastOwner });
}

// poultry-auth §0.3: revocation takes effect on the next online request. Better Auth's sessions are per user.
const revokeSessions = async (tx: Tx, ctx: TenantContext, userId: string) => {
  const { count } = await tx.session.deleteMany({ where: { userId } });
  if (count > 0) await audit(tx, ctx, "Session", userId, "revoke", null, { count });
};

const audit = (
  tx: Tx,
  ctx: Pick<TenantContext, "userId" | "organizationId">,
  entity: string,
  entityId: string,
  action: string,
  before: object | null,
  after: object | null,
) =>
  tx.auditEvent.create({
    data: { organizationId: ctx.organizationId, userId: ctx.userId, entity, entityId, action, before: before ?? undefined, after: after ?? undefined },
  });
