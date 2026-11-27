import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { createOrganization } from "@/modules/farm-registry";
import { addOwner, claimInvitation, inviteMember, setPassword } from "@/modules/identity";
import { fillCompany } from "./company";
import { SEED_FARMS, seedHistory } from "./history";
import { COMPANY_NAME } from "./history/company";
import { exportHistory, importHistory } from "./history/transplant";
import { fillIndividual } from "./individual";
import { addFarmDays } from "@/lib/kernel/farm-day";
import { must, today } from "./kit";

// `pnpm db:seed:demo` (T26, prisma/demo.ts): a demo full of made-up data (ADR-016), through the same sync mutations and
// use cases as the app, so every rule, posting and audit event applies. Two modes:
// - default: a new demo owner (DEMO_PHONE, default +212600000099) with two organisations, « Ferme Démo Ben Ahmed »
//   (individual) and « SARL Démo Avicole » (company). Their password: DEMO_PASSWORD, else a generated one, printed once.
// - into an existing account (DEMO_INTO_EXISTING=1): the user with DEMO_PHONE, as signed up; their organisation (the
//   one they own, or DEMO_ORGANIZATION_ID) is filled while it has no farm, and « SARL Démo Avicole » is added, owned by
//   them. Their password and sessions are never read or changed.
// Both are idempotent: a second run finds what it made and adds nothing. Partners and staff get free made-up numbers.
// - the long history (DEMO_INTO_EXISTING=1 DEMO_HISTORY_FROM=2025-01-01, DEMO_RESET=1 to start clean): src/ops/demo/history.

export const SARL_NAME = "SARL Démo Avicole";
export type DemoOptions = {
  phone: string;
  password?: string;
  intoExisting?: boolean;
  organizationId?: string;
  history?: { from: string; reset: boolean; membersFile: string; rotate: boolean };
  /** The history moved from a local copy to the hosted database (src/ops/demo/history/transplant.ts). */
  exportTo?: string;
  importFrom?: string;
};
export type DemoResult = { added: boolean; lines: string[] };

const PREFIX = "+2126000"; // made-up numbers, never called: +212600000098 downwards, then +212600099999 downwards
const phoneOf = (i: number) => `${PREFIX}${String(i).padStart(5, "0")}`;

/** `n` demo numbers no user, invitation or employee has yet: a second demo seed in the same database never collides. */
export async function freePhones(n: number, exclude: string): Promise<string[]> {
  const where = { startsWith: PREFIX };
  const [users, invitations, employees] = await Promise.all([
    db.user.findMany({ where: { phoneNumber: where }, select: { phoneNumber: true } }),
    db.invitation.findMany({ where: { phoneNumber: where }, select: { phoneNumber: true } }),
    db.employee.findMany({ where: { phone: where }, select: { phone: true } }),
  ]);
  const taken = new Set([exclude, ...users.map((u) => u.phoneNumber), ...invitations.map((i) => i.phoneNumber), ...employees.map((e) => e.phone)]);
  const free: string[] = [];
  for (let i = 98; free.length < n && i !== 99; i = (i + 99_999) % 100_000) if (!taken.has(phoneOf(i))) free.push(phoneOf(i));
  if (free.length < n) throw new Error("demo: no free demo phone number left");
  return free;
}

// Made-up people, named as such (ADR-016): « Démo » in every name.
const newUser = (phoneNumber: string, firstName: string, lastName: string) =>
  db.user.create({ data: { phoneNumber, firstName, lastName, name: `${firstName} ${lastName}`, email: `${phoneNumber.slice(1)}@phone.invalid`, locale: "fr" } });

/** A member who has joined: invited, then the code redeemed by a new user with that number (no password: never signs in). */
async function joined(ctx: TenantContext, phone: string, firstName: string, role: "manager" | "worker") {
  const { code } = must(`${role} invitation`, await inviteMember(ctx, { phone, role, accessUntil: null })).value;
  const user = await newUser(phone, firstName, "Démo");
  must(`${role} joined`, await db.$transaction((tx) => claimInvitation(tx, user.id, code)));
}

/** The SARL, created by its associate (a made-up user) and co-owned by the demo owner, so the switcher shows both. */
async function createSarl(ownerId: string, associatePhone: string): Promise<TenantContext> {
  const associate = await newUser(associatePhone, "Associé", "Démo");
  const sarl = must("SARL onboarding", await createOrganization(associate.id, { name: SARL_NAME, form: "company", locale: "fr" })).value;
  await db.$transaction((tx) => addOwner(tx, { organizationId: sarl.organizationId, userId: ownerId, locale: "fr" }));
  return { userId: ownerId, organizationId: sarl.organizationId, role: "owner" };
}

const farms = (organizationId: string) => db.farm.count({ where: { organizationId } });

export async function seedDemo(o: DemoOptions): Promise<DemoResult> {
  if (o.exportTo) return { added: false, ...(await exportHistory(o.phone, o.exportTo, SEED_FARMS, [SARL_NAME, COMPANY_NAME])) };
  if (o.importFrom) return importHistory(o.phone, o.importFrom);
  if (o.history) {
    if (!o.intoExisting) throw new Error("demo: DEMO_HISTORY_FROM fills an existing account: set DEMO_INTO_EXISTING=1");
    return seedHistory({ phone: o.phone, organizationId: o.organizationId, ...o.history, sarlName: SARL_NAME, freePhones });
  }
  const lines: string[] = [];
  let user = await db.user.findUnique({ where: { phoneNumber: o.phone } });
  let individual: TenantContext | null = null;
  let company: TenantContext | null = null;
  let signIn: string | null = null;
  const [associate, vet, accountant, manager, worker] = await freePhones(5, o.phone);

  if (o.intoExisting) {
    if (!user) throw new Error(`demo: no account with the phone ${o.phone}: sign up with it first`);
    if (o.password) lines.push("demo: DEMO_PASSWORD ignored, an existing account keeps its own password");
    const owned = await db.membership.findMany({ where: { userId: user.id, role: "owner", organization: { leftAt: null } }, select: { organizationId: true, organization: { select: { name: true } } } });
    const sarl = owned.find((x) => x.organization.name === SARL_NAME);
    const candidates = owned.filter((x) => (o.organizationId ? x.organizationId === o.organizationId : x !== sarl));
    if (candidates.length !== 1) {
      const list = owned.map((x) => `${x.organizationId} « ${x.organization.name} »`).join(", ") || "none";
      throw new Error(o.organizationId ? `demo: ${o.organizationId} is not an organisation this account owns (${list})` : `demo: this account owns ${candidates.length} organisations besides the SARL; set DEMO_ORGANIZATION_ID to one of: ${list}`);
    }
    const target = candidates[0];
    if ((await farms(target.organizationId)) === 0) individual = { userId: user.id, organizationId: target.organizationId, role: "owner" };
    else lines.push(`demo: « ${target.organization.name} » already has a farm, left as it is`);
    if (!sarl) company = await createSarl(user.id, associate);
    else if ((await farms(sarl.organizationId)) === 0) company = { userId: user.id, organizationId: sarl.organizationId, role: "owner" };
    else lines.push(`demo: « ${SARL_NAME} » already has a farm, left as it is`);
  } else {
    if (user) {
      if (o.password) lines.push(await demoPassword(user.id, o));
      return { added: false, lines: [...lines, `demo: ${o.phone} already exists, no farm added`] };
    }
    user = await newUser(o.phone, "Démo", "Ben Ahmed");
    signIn = await demoPassword(user.id, o);
    individual = must("onboarding", await createOrganization(user.id, { name: "Ferme Démo Ben Ahmed", form: "individual", locale: "fr" })).value;
    company = await createSarl(user.id, associate);
  }
  if (!individual && !company) return { added: false, lines: [...lines, "demo: nothing added"] };

  let writes = 0;
  if (individual) {
    // First, so that Saïd's and Youssef's records link to the members who sign in with their phones (WF2).
    await joined(individual, manager, "Saïd", "manager");
    await joined(individual, worker, "Youssef", "worker"); // his own tasks and days
    const filled = await fillIndividual(individual, { manager, worker });
    writes += filled.writes;
    const vetCode = must("vet invitation", await inviteMember(individual, { phone: vet, role: "vet", accessUntil: addFarmDays(today, 90) })).value.code;
    const accountantCode = must("accountant invitation", await inviteMember(individual, { phone: accountant, role: "accountant", accessUntil: null })).value.code;
    lines.push(`demo: individual farm: ${filled.writes} writes, bank statement of ${filled.statement.lines} lines (${filled.statement.ticked} ticked); members: manager ${manager} and worker ${worker} joined`);
    lines.push(`demo: pending invitations, joined at /fr/join with the number and the code: vet ${vet} (${vetCode}), accountant ${accountant} (${accountantCode})`);
  }
  if (company) {
    const filled = await fillCompany(company);
    writes += filled.writes;
    const code = must("SARL accountant invitation", await inviteMember(company, { phone: accountant, role: "accountant", accessUntil: null })).value.code;
    lines.push(`demo: « ${SARL_NAME} »: ${filled.writes} writes, bank statement of ${filled.statement.lines} lines (${filled.statement.ticked} ticked); accountant invited, ${accountant} (${code} for the SARL)`);
  }
  lines.push(`demo: ${writes} writes applied. DEMO ONLY, every name and figure is made up.`);
  if (signIn) lines.push(signIn); // last, for whoever presents
  return { added: true, lines };
}

/** The new demo owner's password (ADR-015): DEMO_PASSWORD, else a generated one, printed once. Never for an existing account. */
async function demoPassword(userId: string, o: DemoOptions) {
  const password = o.password || randomBytes(9).toString("base64url");
  must("DEMO_PASSWORD", await setPassword(userId, password));
  return `demo: sign in with ${o.phone} and ${o.password ? "DEMO_PASSWORD" : `the password ${password}`}`;
}
