import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as onboardingRoute } from "@/app/api/onboarding/route";
import { POST as signUpRoute } from "@/app/api/auth/sign-up/route";
import { db } from "@/lib/db";
import { SARL_NAME, seedDemo } from "@/ops/demo";

// T26: `DEMO_INTO_EXISTING=1 pnpm db:seed:demo` fills an account that signed up and onboarded through the app, never
// touching its password or sessions; a second run adds nothing; its partners' made-up numbers avoid every existing one.
const ORIGIN = "http://localhost:3000";
const PHONE = "+212652793289"; // the presenter's account, here a test user with a test password
const post = (route: (req: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  route(new Request(`${ORIGIN}/api/${path}`, { method: "POST", headers: { origin: ORIGIN, "x-requested-with": "poultry", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));

describe("demo seed into an existing account", () => {
  let userId: string;
  const taken = ["+212600000098", "+212600000097", "+212600000096"]; // another demo's partners, already in the database

  beforeAll(async () => {
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    execFileSync("node", ["prisma/seed.ts"], { env: process.env, stdio: "ignore" }); // strains, catalogue, charts, as `pnpm db:seed`
    for (const p of taken) await db.user.create({ data: { phoneNumber: p, name: p, email: `${p.slice(1)}@phone.invalid` } });
    const signedUp = await post(signUpRoute, "auth/sign-up", { phone: "0652793289", password: "a local test phrase", locale: "fr" });
    expect(signedUp.status).toBe(201);
    const cookie = signedUp.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await post(onboardingRoute, "onboarding", { name: "LPRI", form: "individual", locale: "fr" }, cookie)).status).toBe(201);
    userId = (await db.user.findUniqueOrThrow({ where: { phoneNumber: PHONE } })).id;
  }, 60_000);
  afterAll(() => vi.unstubAllEnvs());

  const snapshot = async () => ({
    password: (await db.account.findMany({ where: { userId }, select: { password: true, updatedAt: true } })),
    sessions: (await db.session.findMany({ where: { userId }, select: { id: true, expiresAt: true } })),
    rows: await Promise.all([db.batch.count(), db.sale.count(), db.journalEntry.count(), db.auditEvent.count(), db.user.count(), db.organization.count(), db.invitation.count()]),
  });

  it("refuses a phone with no account", async () => {
    await expect(seedDemo({ phone: "+212652793280", intoExisting: true })).rejects.toThrow(/no account/);
  });

  it("fills the account's organisation, adds the SARL it owns, and leaves its password and sessions alone", { timeout: 600_000 }, async () => {
    const before = await snapshot();
    const result = await seedDemo({ phone: PHONE, intoExisting: true, password: "never used here" });
    expect(result.added).toBe(true);
    expect(result.lines[0]).toMatch(/DEMO_PASSWORD ignored/);

    const after = await snapshot();
    expect(after.password).toEqual(before.password);
    expect(after.sessions).toEqual(before.sessions);

    const owned = await db.membership.findMany({ where: { userId, role: "owner" }, select: { organizationId: true, organization: { select: { name: true } } } });
    expect(owned.map((o) => o.organization.name).sort()).toEqual(["LPRI", SARL_NAME]);
    const lpri = owned.find((o) => o.organization.name === "LPRI")!.organizationId;
    const sarl = owned.find((o) => o.organization.name === SARL_NAME)!.organizationId;
    expect(await db.farm.count({ where: { organizationId: lpri } })).toBe(2);
    expect(await db.farm.count({ where: { organizationId: sarl } })).toBe(1);
    const species = await db.batch.groupBy({ by: ["species", "status"], where: { organizationId: lpri }, _count: true });
    expect(species.map((s) => `${s.species}:${s.status}`).sort()).toEqual(["beldi:closed", "broiler:closed", "broiler:open", "layer:open", "pullet:open", "turkey:open"]);
    expect(await db.legalEntity.findFirst({ where: { organizationId: sarl }, select: { form: true, books: true, vatRegistered: true } })).toEqual({ form: "company", books: "ledger", vatRegistered: true });

    // Partners and staff got numbers no one had: the other demo's stay theirs.
    const members = await db.membership.findMany({ where: { organizationId: { in: [lpri, sarl] }, userId: { not: userId } }, select: { role: true, user: { select: { phoneNumber: true } } } });
    const invited = await db.invitation.findMany({ where: { organizationId: { in: [lpri, sarl] } }, select: { role: true, phoneNumber: true } });
    expect(members.map((m) => m.role).sort()).toEqual(["manager", "owner", "worker"]); // the SARL's associate, the farm's manager and worker
    expect(invited.map((i) => i.role).sort()).toEqual(["accountant", "accountant", "vet"]);
    const phones = [...members.map((m) => m.user.phoneNumber!), ...invited.map((i) => i.phoneNumber)];
    for (const p of phones) expect(taken).not.toContain(p);
    expect(await db.user.count({ where: { phoneNumber: { in: taken } } })).toBe(3);
  });

  it("adds nothing on a second run", { timeout: 120_000 }, async () => {
    const before = await snapshot();
    const result = await seedDemo({ phone: PHONE, intoExisting: true });
    expect(result.added).toBe(false);
    expect(await snapshot()).toEqual(before);
  });
});
