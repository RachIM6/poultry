import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import {
  cancelInvitation,
  changeRole,
  getTenantContext,
  inviteMember,
  listMembers,
  removeMember,
  requestCode,
  verifyCode,
} from "@/modules/identity";
import { tenant, twoTenants } from "@/test/tenant";

// Real login through the code flow; returns the cookie a browser would send next.
async function login(local: string) {
  await requestCode(local, {});
  const e164 = `+212${local.slice(1)}`;
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: e164 }, orderBy: { createdAt: "desc" } })).value.split(":")[0];
  const res = await verifyCode(local, code, "ar", {});
  if (!res.ok) throw new Error(res.error);
  return new Headers({ cookie: res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
}

const contextOf = async (cookie: Headers) => {
  const ctx = await getTenantContext(cookie);
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx.value;
};

const membershipOf = async (owner: TenantContext, phone: string) =>
  (await db.membership.findFirstOrThrow({ where: { organizationId: owner.organizationId, user: { phoneNumber: phone } } })).id;

describe("members (SPEC I4, poultry-auth test matrix: access)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => ([a, b] = await twoTenants())); // after the per-file reset in src/test/db.ts

  it("an invited number logs in, joins with the invited role and creates no organisation", async () => {
    expect(await inviteMember(a, { phone: "06 10 00 00 01", role: "worker" })).toEqual({ ok: true, value: undefined });
    const orgsBefore = await db.organization.count();

    const worker = await contextOf(await login("0610000001"));
    expect(worker).toMatchObject({ organizationId: a.organizationId, role: "worker" });
    expect(await db.organization.count()).toBe(orgsBefore);
    expect(await db.invitation.count({ where: { phoneNumber: "+212610000001" } })).toBe(0);
  });

  it("an expired or cancelled invitation gives no access: the number onboards as a new owner", async () => {
    await inviteMember(a, { phone: "0610000002", role: "manager" });
    await db.invitation.updateMany({ where: { phoneNumber: "+212610000002" }, data: { expiresAt: new Date(0) } });
    expect(await getTenantContext(await login("0610000002"))).toEqual({ ok: false, error: "NO_MEMBERSHIP" });

    await inviteMember(a, { phone: "0610000003", role: "manager" });
    const invitation = await db.invitation.findFirstOrThrow({ where: { phoneNumber: "+212610000003" } });
    expect(await cancelInvitation(a, { invitationId: invitation.id })).toEqual({ ok: true, value: undefined });
    expect(await getTenantContext(await login("0610000003"))).toEqual({ ok: false, error: "NO_MEMBERSHIP" });
  });

  it("refuses bad invitations", async () => {
    expect(await inviteMember(a, { phone: "+33612345678", role: "worker" })).toEqual({ ok: false, error: "INVALID_PHONE" });
    expect(await inviteMember(a, { phone: "0610000009", role: "admin" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await inviteMember(a, { phone: "+212600000001", role: "worker" })).toEqual({ ok: false, error: "ALREADY_MEMBER" }); // a's owner
  });

  it("keeps member management to owners", async () => {
    const worker = { ...a, userId: "00000000-0000-7000-8000-000000000000", role: "worker" as const };
    const manager = { ...worker, role: "manager" as const };
    for (const ctx of [worker, manager]) {
      expect(await inviteMember(ctx, { phone: "0610000010", role: "worker" })).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await listMembers(ctx)).toEqual({ ok: false, error: "FORBIDDEN" });
    }
  });

  it("lists only the caller's organisation, and never lets one owner touch another organisation's members", async () => {
    await inviteMember(b, { phone: "0620000001", role: "worker" });
    const listA = await listMembers(a);
    if (!listA.ok) throw new Error(listA.error);
    expect(listA.value.invitations.map((i) => i.phone)).not.toContain("+212620000001");

    const ownerOfB = (await db.membership.findFirstOrThrow({ where: { organizationId: b.organizationId } })).id;
    expect(await removeMember(a, { membershipId: ownerOfB })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await changeRole(a, { membershipId: ownerOfB, role: "worker" })).toEqual({ ok: false, error: "NOT_FOUND" });
    const invitationOfB = (await db.invitation.findFirstOrThrow({ where: { organizationId: b.organizationId } })).id;
    expect(await cancelInvitation(a, { invitationId: invitationOfB })).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("removing a member logs out all their devices at their next request", async () => {
    await inviteMember(a, { phone: "0610000004", role: "worker" });
    const phoneOne = await login("0610000004");
    const phoneTwo = await login("0610000004");
    await contextOf(phoneOne);

    expect(await removeMember(a, { membershipId: await membershipOf(a, "+212610000004") })).toEqual({ ok: true, value: undefined });
    expect(await getTenantContext(phoneOne)).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(await getTenantContext(phoneTwo)).toEqual({ ok: false, error: "UNAUTHENTICATED" });
  });

  it("a role change logs the member out; the next login carries the new role", async () => {
    await inviteMember(a, { phone: "0610000005", role: "worker" });
    const before = await login("0610000005");
    expect(await changeRole(a, { membershipId: await membershipOf(a, "+212610000005"), role: "manager" })).toEqual({ ok: true, value: undefined });

    expect(await getTenantContext(before)).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(await contextOf(await login("0610000005"))).toMatchObject({ role: "manager" });
    const audited = await db.auditEvent.findFirst({ where: { organizationId: a.organizationId, entity: "Membership", action: "update" } });
    expect(audited).toMatchObject({ userId: a.userId, before: { role: "worker" }, after: { role: "manager" } });
  });

  it("never leaves an organisation without an owner, even when two owners demote each other at once", async () => {
    const solo = await tenant("+212630000001");
    const self = await membershipOf(solo, "+212630000001");
    expect(await changeRole(solo, { membershipId: self, role: "manager" })).toEqual({ ok: false, error: "LAST_OWNER" });
    expect(await removeMember(solo, { membershipId: self })).toEqual({ ok: false, error: "LAST_OWNER" });

    await inviteMember(solo, { phone: "0630000002", role: "owner" });
    const second = await contextOf(await login("0630000002"));
    const other = await membershipOf(solo, "+212630000002");
    const results = await Promise.all([
      changeRole(solo, { membershipId: other, role: "worker" }),
      changeRole(second, { membershipId: self, role: "worker" }),
    ]);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "LAST_OWNER" }]);
    expect(await db.membership.count({ where: { organizationId: solo.organizationId, role: "owner" } })).toBe(1);
  });

  it("caps invitations per invited number (10 / day)", async () => {
    for (let i = 0; i < 10; i++) expect((await inviteMember(a, { phone: "0610000099", role: "worker" })).ok).toBe(true);
    expect(await inviteMember(a, { phone: "0610000099", role: "worker" })).toEqual({ ok: false, error: "TOO_MANY_REQUESTS" });
  });
});
