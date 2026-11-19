import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { farmDayOf } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { getTenantContext, inviteMember, listMembers, requestCode, verifyCode } from "@/modules/identity";
import { twoTenants } from "@/test/tenant";

// SPEC-m5 PA1, PA3 (T90): the owner invites a vet or an accountant, optionally until a day; past it, no access.
async function login(local: string) {
  await requestCode(local, {});
  const e164 = `+212${local.slice(1)}`;
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: `phone-number-otp-${e164}` }, orderBy: { createdAt: "desc" } })).value.split(":")[0];
  const res = await verifyCode(local, code, "fr", {});
  if (!res.ok) throw new Error(res.error);
  return new Headers({ cookie: res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
}

const day = (offset: number) => farmDayOf(new Date(Date.now() + offset * 86_400_000));

describe("partners: vet and accountant (SPEC-m5 PA1, PA3)", () => {
  let a: TenantContext;
  beforeAll(async () => ([a] = await twoTenants()));

  it("the owner invites a vet until a day; the vet signs in with that role, and the members list shows the end", async () => {
    const until = day(30);
    expect(await inviteMember(a, { phone: "0611000001", role: "vet", accessUntil: until })).toEqual({ ok: true, value: undefined });
    const vet = await getTenantContext(await login("0611000001"));
    expect(vet).toMatchObject({ ok: true, value: { organizationId: a.organizationId, role: "vet" } });
    const list = await listMembers(a);
    if (!list.ok) throw new Error(list.error);
    expect(list.value.members.find((m) => m.phone === "+212611000001")).toMatchObject({ role: "vet", accessUntil: until });
  });

  it("an accountant may have no end; an empty date from the form means none", async () => {
    expect(await inviteMember(a, { phone: "0611000002", role: "accountant", accessUntil: "" })).toEqual({ ok: true, value: undefined });
    expect(await getTenantContext(await login("0611000002"))).toMatchObject({ ok: true, value: { role: "accountant" } });
  });

  it("refuses an end day in the past, and an end day for staff", async () => {
    expect(await inviteMember(a, { phone: "0611000003", role: "vet", accessUntil: day(-1) })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await inviteMember(a, { phone: "0611000003", role: "worker", accessUntil: day(30) })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("keeps inviting partners to the owner", async () => {
    expect(await inviteMember({ ...a, role: "manager" }, { phone: "0611000004", role: "vet" })).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("past the end day the membership no longer opens the organisation; on the end day it still does", async () => {
    await inviteMember(a, { phone: "0611000005", role: "vet", accessUntil: day(1) });
    const cookie = await login("0611000005");
    const where = { organizationId: a.organizationId, user: { phoneNumber: "+212611000005" } };
    await db.membership.updateMany({ where, data: { accessUntil: new Date(`${day(0)}T00:00:00Z`) } });
    expect(await getTenantContext(cookie)).toMatchObject({ ok: true, value: { role: "vet" } });
    await db.membership.updateMany({ where, data: { accessUntil: new Date(`${day(-1)}T00:00:00Z`) } });
    expect(await getTenantContext(cookie)).toEqual({ ok: false, error: "NO_MEMBERSHIP" });
  });
});
