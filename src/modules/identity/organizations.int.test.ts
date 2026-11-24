import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { acceptInvitation, chooseOrganization, getTenantContext, inviteMember, myOrganizations, ORG_COOKIE, removeMember, requestCode, verifyCode } from "@/modules/identity";
import { tenant, twoTenants } from "@/test/tenant";

// SPEC-m5 PA2 (T92): a partner who serves two farms accepts the second farm's invitation and switches between them.
async function login(local: string) {
  await requestCode(local, {});
  const e164 = `+212${local.slice(1)}`;
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: `phone-number-otp-${e164}` }, orderBy: { createdAt: "desc" } })).value.split(":")[0];
  const res = await verifyCode(local, code, "fr", {});
  if (!res.ok) throw new Error(res.error);
  return res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const withOrg = (cookie: string, org: string) => new Headers({ cookie: `${cookie}; ${ORG_COOKIE}=${org}` });

describe("one partner, two farms (SPEC-m5 PA2)", () => {
  let a: TenantContext, b: TenantContext, c: TenantContext, cookie: string;
  beforeAll(async () => {
    [a, b] = await twoTenants();
    c = await tenant("+212600000003"); // a farm the vet never joins
    await inviteMember(a, { phone: "0612000001", role: "vet" });
    cookie = await login("0612000001"); // joins a at first login
    await inviteMember(b, { phone: "0612000001", role: "vet" }); // already a member elsewhere: stays pending
  });

  it("lists the farm they belong to and the pending invitation; accepting it adds the second farm", async () => {
    const mine = await myOrganizations(new Headers({ cookie }));
    if (!mine.ok) throw new Error(mine.error);
    expect(mine.value.memberships.map((m) => m.organizationId)).toEqual([a.organizationId]);
    expect(mine.value.current).toBe(a.organizationId);
    const [invitation] = mine.value.invitations;
    expect(invitation).toMatchObject({ organizationId: b.organizationId, role: "vet" });

    expect(await acceptInvitation(new Headers({ cookie }), invitation.id)).toEqual({ ok: true, value: b.organizationId });
    const after = await myOrganizations(new Headers({ cookie }));
    expect(after.ok && after.value.memberships.map((m) => m.organizationId).sort()).toEqual([a.organizationId, b.organizationId].sort());
    expect(after.ok && after.value.invitations).toEqual([]);
  });

  it("the chosen farm opens; a farm they don't belong to, or a forged value, falls back to the oldest", async () => {
    expect(await getTenantContext(withOrg(cookie, b.organizationId))).toMatchObject({ ok: true, value: { organizationId: b.organizationId, role: "vet" } });
    expect(await getTenantContext(new Headers({ cookie }))).toMatchObject({ ok: true, value: { organizationId: a.organizationId } });
    expect(await getTenantContext(withOrg(cookie, c.organizationId))).toMatchObject({ ok: true, value: { organizationId: a.organizationId } });
    expect(await getTenantContext(withOrg(cookie, "not-a-uuid"))).toMatchObject({ ok: true, value: { organizationId: a.organizationId } });
  });

  it("choosing is allowed only for a live membership", async () => {
    expect(await chooseOrganization(new Headers({ cookie }), b.organizationId)).toEqual({ ok: true, value: undefined });
    expect(await chooseOrganization(new Headers({ cookie }), c.organizationId)).toEqual({ ok: false, error: "NOT_FOUND" });
    await db.membership.updateMany({ where: { organizationId: b.organizationId, user: { phoneNumber: "+212612000001" } }, data: { accessUntil: new Date("2020-01-01T00:00:00Z") } });
    expect(await chooseOrganization(new Headers({ cookie }), b.organizationId)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await getTenantContext(withOrg(cookie, b.organizationId))).toMatchObject({ ok: true, value: { organizationId: a.organizationId } });
  });

  it("someone else's invitation cannot be accepted", async () => {
    await inviteMember(b, { phone: "0612000002", role: "accountant" });
    const other = await db.invitation.findFirstOrThrow({ where: { phoneNumber: "+212612000002" } });
    expect(await acceptInvitation(new Headers({ cookie }), other.id)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("T93: a farm that removes its vet is closed to them at once; their other farm still opens", async () => {
    await inviteMember(c, { phone: "0612000001", role: "vet" });
    const mine = await myOrganizations(new Headers({ cookie }));
    const invitation = mine.ok ? mine.value.invitations.find((i) => i.organizationId === c.organizationId) : undefined;
    expect(await acceptInvitation(new Headers({ cookie }), invitation!.id)).toEqual({ ok: true, value: c.organizationId });
    expect(await getTenantContext(withOrg(cookie, c.organizationId))).toMatchObject({ ok: true, value: { organizationId: c.organizationId } });

    const membership = await db.membership.findFirstOrThrow({ where: { organizationId: c.organizationId, user: { phoneNumber: "+212612000001" } } });
    expect(await removeMember(c, { membershipId: membership.id }, async () => {})).toEqual({ ok: true, value: undefined });
    expect(await getTenantContext(withOrg(cookie, c.organizationId))).toMatchObject({ ok: true, value: { organizationId: a.organizationId } });
    expect(await chooseOrganization(new Headers({ cookie }), c.organizationId)).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
