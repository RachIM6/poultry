import { db, type Tx } from "@/lib/db";
import { clearOrganizationData, DELETED, deleteUsers, KEPT, operator } from "@/ops/organization-data";
import { MEMBER_EMAILS } from "./members";

// DEMO_RESET=1 (src/ops/demo/history): empties the demo owner's organisation (its row, the owner's membership and
// the owner's own settings stay) and deletes the seed's company and made-up users, so the long history starts clean.
// Refused unless every organisation it would touch looks like the demo seed's, so a customer's farm is never wiped.

export const DEMO_PREFIX = "+2126000"; // the seed's made-up numbers (src/ops/demo/index.ts)
/** The ledger's write-once triggers (prisma/migrations: ledger, posting overrides): lifted inside the reset only. */
const WRITE_ONCE: [string, string][] = [["JournalEntry", "JournalEntry_immutable"], ["JournalLine", "JournalLine_immutable"], ["PostingOverride", "PostingOverride_append_only"]];
/** Kept for the organisation itself: its legal entity (created with it), its members (handled below), its sync log (tombstoned). */
const KEEP = ["LegalEntity", "Membership", "Change", "SyncVersion"];

export type Org = { id: string; name: string };

/** Why `orgs` don't look like the demo seed's (no company of the seed's, a farm or a member it never made), or null. */
export async function notDemo(ownerId: string, orgs: Org[], farmNames: string[], companyNames: string[], farmOrgId: string): Promise<string | null> {
  if (!orgs.some((o) => companyNames.includes(o.name))) return "this account co-owns no company the demo seed made";
  for (const org of orgs) {
    if (org.id !== farmOrgId && !companyNames.includes(org.name)) return `« ${org.name} » is not a company the demo seed makes`;
    const farms = await db.farm.findMany({ where: { organizationId: org.id }, select: { name: true } });
    const odd = farms.find((f) => !farmNames.includes(f.name));
    if (odd) return `« ${org.name} » has a farm the demo seed never made: « ${odd.name} »`;
    const members = await db.membership.findMany({ where: { organizationId: org.id }, select: { user: { select: { id: true, phoneNumber: true, email: true } } } });
    const stranger = members.find(({ user: u }) => u.id !== ownerId && !(u.phoneNumber?.startsWith(DEMO_PREFIX) && u.email.endsWith("@phone.invalid")) && !MEMBER_EMAILS.includes(u.email));
    if (stranger) return `« ${org.name} » has a member the demo seed never made`;
  }
  return null;
}

/**
 * A deletion for every record of the organisation's sync log, after its last version: a phone that kept a copy drops
 * the records it had (ADR-014), a new phone's snapshot never sees them. The counter keeps counting from there.
 */
async function tombstone(tx: Tx, organizationId: string) {
  const [counter] = await tx.$queryRaw<{ version: bigint }[]>`SELECT version FROM "SyncVersion" WHERE "organizationId" = ${organizationId}::uuid FOR UPDATE`;
  if (!counter) return 0;
  const n = await tx.$executeRaw`
    WITH old AS (DELETE FROM "Change" WHERE "organizationId" = ${organizationId}::uuid RETURNING entity, "entityId"),
    records AS (SELECT DISTINCT entity, "entityId" FROM old)
    INSERT INTO "Change" ("organizationId", version, entity, "entityId", data)
    SELECT ${organizationId}::uuid, ${counter.version} + row_number() OVER (ORDER BY entity, "entityId"), entity, "entityId", NULL FROM records`;
  await tx.$executeRaw`UPDATE "SyncVersion" SET version = version + ${n} WHERE "organizationId" = ${organizationId}::uuid`;
  return n;
}

export const RESET_TX = { timeout: 15 * 60_000, maxWait: 30_000 };

/** The reset, in one transaction: all of it or nothing. Returns the rows deleted, per organisation and table. */
export const resetDemo = (ownerId: string, farm: Org, companies: Org[]) => db.$transaction((tx) => resetIn(tx, ownerId, farm, companies), RESET_TX);

/**
 * The reset inside the caller's transaction (transplant.ts adds the history to it). `syncBefore`: the organisation's
 * sync counter before it, which a transplant checks the hosted database still has.
 */
export async function resetIn(tx: Tx, ownerId: string, farm: Org, companies: Org[]) {
  const [before] = await tx.$queryRaw<{ version: bigint }[]>`SELECT version FROM "SyncVersion" WHERE "organizationId" = ${farm.id}::uuid`;
  const orgIds = [farm.id, ...companies.map((c) => c.id)];
  const members = (await tx.membership.findMany({ where: { organizationId: { in: orgIds } }, select: { userId: true } })).map((m) => m.userId);
  for (const [table, trigger] of WRITE_ONCE) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
  const tombstones = await tombstone(tx, farm.id);
  const kept = await clearOrganizationData(tx, farm.id, [...KEPT, ...DELETED].filter((t) => !KEEP.includes(t)));
  kept.Membership = (await tx.membership.deleteMany({ where: { organizationId: farm.id, userId: { not: ownerId } } })).count;
  const counts: Record<string, Record<string, number>> = { [farm.name]: kept };
  for (const c of companies) {
    counts[c.name] = await clearOrganizationData(tx, c.id, [...KEPT, ...DELETED]);
    await tx.organization.delete({ where: { id: c.id } });
  }
  for (const [table, trigger] of WRITE_ONCE) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
  // The seed's made-up users who now belong nowhere, with what is theirs alone.
  const gone = await tx.user.findMany({ where: { id: { in: members }, phoneNumber: { startsWith: DEMO_PREFIX }, email: { endsWith: "@phone.invalid" }, memberships: { none: {} } }, select: { id: true, phoneNumber: true } });
  const users = (await deleteUsers(tx, gone)).length;
  const deleted = Object.fromEntries(Object.entries(counts).map(([org, t]) => [org, Object.fromEntries(Object.entries(t).filter(([, n]) => n > 0))]));
  const summary = { syncBefore: before ? String(before.version) : null, tombstones, users, deleted };
  await tx.auditEvent.create({ data: { organizationId: farm.id, entity: "Organization", entityId: farm.id, action: "demo-reset", after: { ...summary, operator: operator() } } });
  return summary;
}
