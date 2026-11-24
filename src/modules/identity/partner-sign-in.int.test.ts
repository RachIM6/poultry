import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { acceptInvitation, inviteMember, myOrganizations, ORG_COOKIE, requestCode, verifyCode } from "@/modules/identity";
import { twoTenants } from "@/test/tenant";

// SPEC-m5 PA6: every partner sign-in to an organisation is in that organisation's audit log, as a `Membership/open`:
// the organisation the browser last chose when it is still theirs, else the oldest (what getTenantContext opens).
async function signIn(local: string, headers?: Headers) {
  await requestCode(local, {});
  const e164 = `+212${local.slice(1)}`;
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: `phone-number-otp-${e164}` }, orderBy: { createdAt: "desc" } })).value.split(":")[0];
  const res = await verifyCode(local, code, "fr", {}, undefined, headers);
  if (!res.ok) throw new Error(res.error);
  return new Headers({ cookie: res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
}
const opens = (organizationId: string) => db.auditEvent.findMany({ where: { organizationId, entity: "Membership", action: "open" } });

describe("a partner's sign-in is audited in the organisation it opens (SPEC-m5 PA6)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => ([a, b] = await twoTenants()));

  it("the first sign-in, which accepts the invitation, opens it and is audited there", async () => {
    await inviteMember(a, { phone: "0613000001", role: "vet" });
    const cookie = await signIn("0613000001");
    const vet = await db.user.findUniqueOrThrow({ where: { phoneNumber: "+212613000001" } });
    const membership = await db.membership.findFirstOrThrow({ where: { organizationId: a.organizationId, userId: vet.id } });
    expect(await opens(a.organizationId)).toMatchObject([{ userId: vet.id, entityId: membership.id, after: { role: "vet", signIn: true } }]);

    await inviteMember(b, { phone: "0613000001", role: "vet" }); // a second farm, accepted while signed in
    const mine = await myOrganizations(cookie);
    expect(mine.ok && (await acceptInvitation(cookie, mine.value.invitations[0].id))).toEqual({ ok: true, value: b.organizationId });
  });

  it("signing in again opens the farm chosen last, else the oldest; each sign-in is one line in that farm", async () => {
    await signIn("0613000001", new Headers({ cookie: `${ORG_COOKIE}=${b.organizationId}` }));
    expect(await opens(b.organizationId)).toHaveLength(1);
    expect(await opens(a.organizationId)).toHaveLength(1);

    await signIn("0613000001");
    expect(await opens(a.organizationId)).toHaveLength(2);
    expect(await opens(b.organizationId)).toHaveLength(1);
  });

  it("staff sign-ins write no open (their login is an auth event)", async () => {
    await signIn("0600000002"); // b's owner
    expect(await opens(b.organizationId)).toHaveLength(1);
  });
});
