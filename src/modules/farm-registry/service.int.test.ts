import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createOrganization, getLegalEntity, listLegalEntities } from "@/modules/farm-registry";
import { getTenantContext, requestCode, verifyCode } from "@/modules/identity";
import { twoTenants } from "@/test/tenant";

const newUser = (phone: string) =>
  db.user.create({ data: { phoneNumber: phone, name: phone, email: `${phone.slice(1)}@phone.invalid`, locale: "ar" } });

describe("onboarding (SPEC F1, I3)", () => {
  it("creates the organisation, its legal entity and the owner membership, saves the language and audits it", async () => {
    const user = await newUser("+212611111111");
    const ctx = await createOrganization(user.id, { name: "Ferme El Kheir", form: "indivision", locale: "fr" });
    if (!ctx.ok) throw new Error(ctx.error);

    expect(ctx.value).toMatchObject({ userId: user.id, role: "owner" });
    expect(await listLegalEntities(ctx.value)).toEqual([
      expect.objectContaining({ name: "Ferme El Kheir", form: "indivision", accountingProfile: { chart: "cash_book", coOwnerShares: true } }),
    ]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).locale).toBe("fr");
    const audited = await db.auditEvent.findMany({ where: { organizationId: ctx.value.organizationId }, select: { entity: true, action: true, userId: true } });
    expect(audited.map((a) => a.entity).sort()).toEqual(["LegalEntity", "Membership", "Organization"]);
    expect(audited.every((a) => a.action === "create" && a.userId === user.id)).toBe(true);
  });

  it("creates one organisation when the form is submitted twice at once", async () => {
    const user = await newUser("+212622222222");
    const input = { name: "Ferme", form: "company", locale: "ar" } as const;
    const results = await Promise.all([createOrganization(user.id, input), createOrganization(user.id, input)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "ALREADY_ONBOARDED" }]);
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.organization.count({ where: { memberships: { some: { userId: user.id } } } })).toBe(1);
  });
});

describe("tenant isolation (ADR-006)", () => {
  it("never shows organisation B's legal entity to user A", async () => {
    const [a, b] = await twoTenants();
    const [ofB] = await listLegalEntities(b);

    expect(await getLegalEntity(b, ofB.id)).toMatchObject({ name: "Ferme B" });
    expect(await getLegalEntity(a, ofB.id)).toBeNull(); // → 404
    expect((await listLegalEntities(a)).map((e) => e.name)).toEqual(["Ferme A"]);
  });
});

describe("getTenantContext", () => {
  const cookieOf = (setCookie: Headers) => new Headers({ cookie: setCookie.getSetCookie().map((c) => c.split(";")[0]).join("; ") });

  it("is UNAUTHENTICATED without a session, NO_MEMBERSHIP before onboarding, the owner's context after", async () => {
    expect(await getTenantContext(new Headers())).toEqual({ ok: false, error: "UNAUTHENTICATED" });

    await requestCode("0633333333", {});
    const code = (await db.verification.findFirstOrThrow({ where: { identifier: "+212633333333" } })).value.split(":")[0];
    const login = await verifyCode("0633333333", code, "ar", {});
    if (!login.ok) throw new Error(login.error);
    const cookie = cookieOf(login.value);
    expect(await getTenantContext(cookie)).toEqual({ ok: false, error: "NO_MEMBERSHIP" });

    const user = await db.user.findUniqueOrThrow({ where: { phoneNumber: "+212633333333" } });
    const created = await createOrganization(user.id, { name: "Ferme C", form: "cooperative", locale: "ar" });
    expect(await getTenantContext(cookie)).toEqual(created);
  });
});
