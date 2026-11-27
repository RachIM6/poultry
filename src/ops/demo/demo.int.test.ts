import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as onboardingRoute } from "@/app/api/onboarding/route";
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { POST as signUpRoute } from "@/app/api/auth/sign-up/route";
import { db } from "@/lib/db";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { SARL_NAME, seedDemo } from "@/ops/demo";
import { COMPANY_NAME } from "@/ops/demo/history/company";
import { MEMBERS } from "@/ops/demo/history/members";
import { DELETED, KEPT } from "@/ops/organization-data";
import { tenant } from "@/test/tenant";

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
    const signedUp = await post(signUpRoute, "auth/sign-up", { phone: "0652793289", firstName: "Amine", lastName: "Test", password: "a local test phrase", locale: "fr" });
    expect(signedUp.status).toBe(201);
    const cookie = signedUp.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await post(onboardingRoute, "onboarding", { name: "LPRI", form: "individual", locale: "fr" }, cookie)).status).toBe(201);
    userId = (await db.user.findUniqueOrThrow({ where: { phoneNumber: PHONE } })).id;
  }, 60_000);
  afterAll(() => vi.unstubAllEnvs());

  const snapshot = async () => ({
    password: (await db.account.findMany({ where: { userId }, select: { password: true, updatedAt: true } })),
    sessions: (await db.session.findMany({ where: { userId }, select: { id: true, expiresAt: true } })),
    names: await db.user.findUnique({ where: { id: userId }, select: { name: true, firstName: true, lastName: true } }), // the account's own name stays
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
    expect(after.names).toEqual({ name: "Amine Test", firstName: "Amine", lastName: "Test" });

    const owned = await db.membership.findMany({ where: { userId, role: "owner" }, select: { organizationId: true, organization: { select: { name: true } } } });
    expect(owned.map((o) => o.organization.name).sort()).toEqual(["LPRI", SARL_NAME]);
    const lpri = owned.find((o) => o.organization.name === "LPRI")!.organizationId;
    const sarl = owned.find((o) => o.organization.name === SARL_NAME)!.organizationId;
    expect(await db.farm.count({ where: { organizationId: lpri } })).toBe(2);
    const staff = await db.user.findMany({ where: { memberships: { some: { organizationId: lpri, role: { in: ["manager", "worker"] } } } }, select: { name: true, firstName: true, lastName: true } });
    expect(staff.map((u) => u.name).sort()).toEqual(["Saïd Démo", "Youssef Démo"]); // made-up members, named as made up
    expect(staff.every((u) => u.name === `${u.firstName} ${u.lastName}`)).toBe(true);
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

// The long history (DEMO_HISTORY_FROM, DEMO_RESET): the same account, after the scenario above, reset and told again
// from a past day; four members who sign in by email; a second run adds nothing. A shorter story than the hosted one
// (from 1 September last year: the past year still closes in March), the same code.
describe("demo seed, the long history", () => {
  const file = join(tmpdir(), `demo-members-${process.pid}.txt`);
  const today = farmDayOf(new Date());
  const from = `${Number(today.slice(0, 4)) - 1}-09-01`;
  const history = (phone = PHONE) => ({ phone, intoExisting: true, history: { from, reset: true, membersFile: file, rotate: false } });
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    userId = (await db.user.findUniqueOrThrow({ where: { phoneNumber: PHONE } })).id;
  });
  afterAll(() => {
    rmSync(file, { force: true });
    vi.unstubAllEnvs();
  });

  it("refuses to reset organisations the demo seed did not make", async () => {
    const other = await tenant("+212661000001", "Ferme Ouled Ali");
    await db.farm.create({ data: { id: "01a20000-0000-7000-8000-000000000001", organizationId: other.organizationId, name: "Ferme Ouled Ali", region: "Souss-Massa", province: "Agadir", commune: "Drarga" } });
    await expect(seedDemo(history("+212661000001"))).rejects.toThrow(/reset refused/);
    expect(await db.farm.count({ where: { organizationId: other.organizationId } })).toBe(1);
    // A stranger in the seed's SARL: refused too, nothing touched.
    const sarl = (await db.organization.findFirstOrThrow({ where: { name: SARL_NAME, memberships: { some: { userId } } } })).id;
    const stranger = await db.membership.create({ data: { organizationId: sarl, userId: other.userId, role: "manager" } });
    await expect(seedDemo(history())).rejects.toThrow(/reset refused/);
    await db.membership.delete({ where: { id: stranger.id } });
    expect(await db.farm.count({ where: { organizationId: sarl } })).toBe(1);
  });

  it("resets the demo's organisations, tells the history, and the four members sign in by email", { timeout: 1_800_000 }, async () => {
    const before = {
      password: await db.account.findMany({ where: { userId }, select: { password: true, updatedAt: true } }),
      sessions: await db.session.findMany({ where: { userId }, select: { id: true, expiresAt: true } }),
      lpri: await db.organization.findFirstOrThrow({ where: { name: "LPRI" } }),
      ownerMembership: await db.membership.findFirstOrThrow({ where: { userId, organization: { name: "LPRI" } } }),
    };
    const result = await seedDemo(history());
    expect(result.added).toBe(true);
    expect(await db.account.findMany({ where: { userId }, select: { password: true, updatedAt: true } })).toEqual(before.password);
    expect(await db.session.findMany({ where: { userId }, select: { id: true, expiresAt: true } })).toEqual(before.sessions);
    expect(await db.organization.findUniqueOrThrow({ where: { id: before.lpri.id } })).toEqual(before.lpri); // its row and name stay
    expect(await db.membership.findFirstOrThrow({ where: { userId, organizationId: before.lpri.id } })).toEqual(before.ownerMembership);

    const owned = await db.membership.findMany({ where: { userId, role: "owner" }, select: { organization: { select: { id: true, name: true } } } });
    expect(owned.map((o) => o.organization.name).sort()).toEqual(["LPRI", COMPANY_NAME]); // the old SARL is gone
    const company = owned.find((o) => o.organization.name === COMPANY_NAME)!.organization.id;
    expect(await db.user.count({ where: { name: { contains: "Démo" } } })).toBe(0); // the old scenario's made-up people too
    expect(await db.user.count({ where: { phoneNumber: { in: ["+212600000098", "+212600000097", "+212600000096"] } } })).toBe(3); // not theirs: kept
    expect(await db.farm.count({ where: { organizationId: before.lpri.id } })).toBe(2);
    expect(await db.house.count({ where: { organizationId: before.lpri.id } })).toBe(6);
    const species = await db.batch.groupBy({ by: ["species", "status"], where: { organizationId: before.lpri.id }, _count: true });
    expect(species.map((x) => `${x.species}:${x.status}`)).toEqual(expect.arrayContaining(["broiler:closed", "broiler:open", "layer:open", "turkey:open", "beldi:open"]));
    // The past year closed in March: locked, its à-nouveaux posted on 1 January.
    const closed = today >= `${today.slice(0, 4)}-03-17`;
    expect(await db.fiscalYearClose.count({ where: { organizationId: company } })).toBe(closed ? 1 : 0);
    if (closed) expect(await db.journalEntry.count({ where: { organizationId: company, label: "À-nouveaux", day: new Date(`${today.slice(0, 4)}-01-01T00:00:00Z`) } })).toBe(1);

    // The members, by email, with the roles the app knows; their passwords only in the file; each signs in.
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.includes("\t"));
    expect(lines.map((l) => l.split("\t")[0])).toEqual(MEMBERS.map((m) => m.email));
    const roles = await db.membership.findMany({ where: { user: { email: { in: MEMBERS.map((m) => m.email) } } }, select: { role: true, organizationId: true } });
    expect(roles.filter((r) => r.organizationId === before.lpri.id).map((r) => r.role).sort()).toEqual(["accountant", "manager", "vet", "worker"]);
    expect(roles.filter((r) => r.organizationId === company).map((r) => r.role)).toEqual(["accountant"]);
    for (const line of lines) {
      const [email, , , password] = line.split("\t");
      expect(password).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z\d]).{14,}$/);
      expect(result.lines.join("\n")).not.toContain(password);
      const res = await post(signInRoute, "auth/sign-in", { identifier: email, password, locale: "fr" });
      expect(res.status, email).toBe(200);
    }

    // Nothing visible says demo, made-up or test: every value of every row of both organisations, the members' names.
    const words = /d[ée]mo|fictif|fictive|\btest\b/i;
    const hidden = ["AuditEvent", "Mutation", "Change", "StoredFile"]; // never shown: the operator's log, the sync log, file bytes
    for (const table of [...KEPT, ...DELETED].filter((t) => !hidden.includes(t))) {
      const rows = await db.$queryRawUnsafe<{ row: string }[]>(`SELECT t::text AS row FROM "${table}" t WHERE "organizationId" = ANY($1::uuid[])`, [before.lpri.id, company]);
      for (const { row } of rows) expect(row, table).not.toMatch(words);
    }
    const people = await db.user.findMany({ where: { id: { not: userId }, memberships: { some: { organizationId: { in: [before.lpri.id, company] } } } }, select: { name: true } }); // the owner is this test's
    for (const p of people) expect(p.name).not.toMatch(words);
  });

  it("adds nothing on a second run, the members' passwords kept", { timeout: 300_000 }, async () => {
    const count = () => Promise.all([db.batch.count(), db.dailyEntry.count(), db.sale.count(), db.journalEntry.count(), db.user.count(), db.organization.count(), db.membership.count(), db.account.findMany({ orderBy: { id: "asc" }, select: { password: true } })]);
    const before = await count();
    const members = readFileSync(file, "utf8");
    expect(await seedDemo(history())).toEqual({ added: false, lines: [expect.stringMatching(/nothing added/)] });
    expect(await count()).toEqual(before);
    expect(readFileSync(file, "utf8")).toBe(members);
  });

  // Moving it to the hosted database (DEMO_EXPORT, DEMO_IMPORT): the rows of both organisations, and an import that
  // finds the history already there adds nothing. (A full move is rehearsed on a copy: docs/deploy-vercel-supabase.md.)
  it("exports the history's rows, and an import where it already is adds nothing", { timeout: 300_000 }, async () => {
    const out = join(tmpdir(), `demo-history-${process.pid}.jsonl`);
    try {
      const exported = await seedDemo({ phone: PHONE, exportTo: out });
      const lines = readFileSync(out, "utf8").split("\n").filter(Boolean);
      expect(lines[0]).toMatch(/^#meta\t/);
      expect(JSON.parse(lines[0].slice(6))).toMatchObject({ farm: { name: "LPRI" }, syncBefore: expect.any(String) });
      const tables = new Set(lines.slice(1).map((l) => l.slice(0, l.indexOf("\t"))));
      for (const t of ["Organization", "User", "Account", "Batch", "DailyEntry", "JournalEntry", "JournalLine", "Change", "FiscalYearClose", "CleanoutStep"]) expect(tables, t).toContain(t);
      expect(exported.lines[0]).toMatch(/rows of « LPRI »/);
      expect(await seedDemo({ phone: PHONE, importFrom: out })).toEqual({ added: false, lines: [expect.stringMatching(/nothing added/)] });
    } finally {
      rmSync(out, { force: true });
    }
  });
});
