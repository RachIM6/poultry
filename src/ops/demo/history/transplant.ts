import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { db } from "@/lib/db";
import { DELETED, KEPT, referencingFirst } from "@/ops/organization-data";
import { COMPANY_NAME } from "./company";
import { notDemo, resetIn, RESET_TX } from "./reset";

// The long history played on a copy, then moved in one go (DEMO_EXPORT, DEMO_IMPORT). Playing it through the app's
// rules takes some 220 000 queries one after another, hours at a hosted database's 40 ms each. So it is played on a
// local copy of the hosted database (restored from a fresh backup, the same rules and the same story), its rows
// written to a file, and the hosted database gets the same reset and those rows in one transaction, a few hundred
// statements. Refused when the hosted organisation changed since the backup (its sync counter moved), when the
// schemas differ, or when a member's email or number is already someone else's there.

const MARKER = "demo-history";
const ROWS = 1000; // rows to a statement
type Meta = { ownerId: string; farm: { id: string; name: string }; companyId: string; syncBefore: string | null; sync: Record<string, string>; migration: string; farmNames: string[]; companyNames: string[] };

const lastMigration = async () => (await db.$queryRaw<{ name: string }[]>`SELECT max(migration_name) AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL`)[0].name;
const ownerOf = async (phone: string) => {
  const user = await db.user.findUnique({ where: { phoneNumber: phone } });
  if (!user) throw new Error(`demo: no account with the phone ${phone}`);
  return user;
};

/** On the copy, after the history: its rows and what the import checks, to `file`. */
export async function exportHistory(phone: string, file: string, farmNames: string[], companyNames: string[]) {
  const owner = await ownerOf(phone);
  const owned = (await db.membership.findMany({ where: { userId: owner.id, role: "owner" }, select: { organizationId: true } })).map((m) => m.organizationId);
  const marker = await db.auditEvent.findFirst({ where: { action: MARKER, organizationId: { in: owned } }, select: { organizationId: true } });
  if (!marker) throw new Error("demo: no history here to export: run DEMO_HISTORY_FROM first");
  const farm = await db.organization.findUniqueOrThrow({ where: { id: marker.organizationId }, select: { id: true, name: true } });
  const company = await db.organization.findFirstOrThrow({ where: { name: COMPANY_NAME, memberships: { some: { userId: owner.id, role: "owner" } } }, select: { id: true } });
  const reset = await db.auditEvent.findFirst({ where: { organizationId: farm.id, action: "demo-reset" }, orderBy: { id: "desc" } });
  if (!reset) throw new Error("demo: the history was told without DEMO_RESET=1: nothing to move");
  const sync = Object.fromEntries((await db.syncVersion.findMany({ where: { organizationId: { in: [farm.id, company.id] } } })).map((v) => [v.organizationId, String(v.version)]));
  const meta: Meta = { ownerId: owner.id, farm, companyId: company.id, syncBefore: (reset.after as { syncBefore: string | null }).syncBefore, sync, migration: await lastMigration(), farmNames, companyNames };

  const orgs = `('${farm.id}'::uuid, '${company.id}'::uuid)`; // ids from the database
  const users = `SELECT "userId" FROM "Membership" WHERE "organizationId" IN ${orgs} AND "userId" <> '${owner.id}'::uuid`;
  const tables = (await db.$transaction((tx) => referencingFirst(tx, [...KEPT, ...DELETED]))).reverse().filter((t) => t !== "SyncVersion");
  const plan: [string, string][] = [
    ["Organization", `id = '${company.id}'::uuid`],
    ["User", `id IN (${users})`],
    ["Account", `"userId" IN (${users})`],
    ...tables.map((t): [string, string] => [
      t,
      t === "LegalEntity" ? `"organizationId" = '${company.id}'::uuid` : t === "Membership" ? `"organizationId" IN ${orgs} AND NOT ("organizationId" = '${farm.id}'::uuid AND "userId" = '${owner.id}'::uuid)` : `"organizationId" IN ${orgs}`,
    ]),
    ["CleanoutStep", `"cleanoutId" IN (SELECT id FROM "Cleanout" WHERE "organizationId" IN ${orgs})`],
  ];
  const fd = openSync(file, "w", 0o600);
  let rows = 0;
  try {
    writeSync(fd, `#meta\t${JSON.stringify(meta)}\n`);
    for (const [table, where] of plan) {
      const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`);
      for (let k = 0; k < Number(n); k += ROWS) {
        // Postgres writes the JSON (jsonb: one line), exact bigints, dates and bytes; nothing goes through a JS number.
        const [{ json }] = await db.$queryRawUnsafe<{ json: string }[]>(`SELECT jsonb_agg(t)::text AS json FROM (SELECT * FROM "${table}" WHERE ${where} ORDER BY ctid LIMIT ${ROWS} OFFSET ${k}) t`);
        writeSync(fd, `${table}\t${json}\n`);
      }
      rows += Number(n);
    }
  } finally {
    closeSync(fd);
  }
  return { rows, lines: [`demo: ${rows} rows of « ${farm.name} » and « ${COMPANY_NAME} » written to ${file}; import them with DEMO_IMPORT`] };
}

/** On the hosted database: the same reset, then the copy's rows, in one transaction. */
export async function importHistory(phone: string, file: string) {
  const [head, ...lines] = readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (!head.startsWith("#meta\t")) throw new Error("demo: not a history export");
  const meta = JSON.parse(head.slice(6)) as Meta;
  const owner = await ownerOf(phone);
  if (owner.id !== meta.ownerId) throw new Error("demo: this account is not the one the export was made for");
  const farm = await db.organization.findFirst({ where: { id: meta.farm.id, name: meta.farm.name, leftAt: null, memberships: { some: { userId: owner.id, role: "owner" } } }, select: { id: true, name: true } });
  if (!farm) throw new Error(`demo: « ${meta.farm.name} » is not this account's here`);
  if (await db.auditEvent.findFirst({ where: { organizationId: farm.id, action: MARKER } })) return { added: false, lines: [`demo: « ${farm.name} » already holds the history: nothing added`] };
  if ((await lastMigration()) !== meta.migration) throw new Error(`demo: the schemas differ (here ${await lastMigration()}, the copy ${meta.migration}): migrate first`);
  const counter = await db.syncVersion.findUnique({ where: { organizationId: farm.id } });
  if ((counter ? String(counter.version) : null) !== meta.syncBefore) throw new Error(`demo: « ${farm.name} » changed since the backup the copy was made from: take a new backup and play the history again`);
  const companies = (await db.membership.findMany({ where: { userId: owner.id, role: "owner", organization: { leftAt: null, name: { in: meta.companyNames } } }, select: { organization: { select: { id: true, name: true } } } })).map((m) => m.organization);
  const why = await notDemo(owner.id, [farm, ...companies], meta.farmNames, meta.companyNames, farm.id);
  if (why) throw new Error(`demo: reset refused, ${why}`);
  const people = lines.filter((l) => l.startsWith("User\t")).flatMap((l) => JSON.parse(l.slice(5)) as { id: string; email: string; phoneNumber: string | null }[]);
  const taken = await db.user.findMany({ where: { OR: [{ email: { in: people.map((u) => u.email) } }, { phoneNumber: { in: people.flatMap((u) => (u.phoneNumber ? [u.phoneNumber] : [])) } }] }, select: { id: true, phoneNumber: true } });
  const goes = (u: { phoneNumber: string | null }) => u.phoneNumber?.startsWith("+2126000"); // the old scenario's made-up users, deleted by the reset
  if (taken.some((u) => !goes(u))) throw new Error("demo: a member's email or number is already an account here: nothing imported");

  let rows = 0;
  const reset = await db.$transaction(
    async (tx) => {
      const r = await resetIn(tx, owner.id, farm, companies);
      await tx.$executeRaw`DELETE FROM "Change" WHERE "organizationId" = ${farm.id}::uuid`; // the copy's log: the same deletions, then the history
      for (const line of lines) {
        const tab = line.indexOf("\t");
        const table = line.slice(0, tab);
        rows += await tx.$executeRawUnsafe(`INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`, line.slice(tab + 1));
      }
      for (const [organizationId, version] of Object.entries(meta.sync))
        await tx.$executeRaw`INSERT INTO "SyncVersion" ("organizationId", version) VALUES (${organizationId}::uuid, ${BigInt(version)}) ON CONFLICT ("organizationId") DO UPDATE SET version = EXCLUDED.version`;
      return r;
    },
    { ...RESET_TX, timeout: 30 * 60_000 },
  );
  return { added: true, lines: [`demo: reset « ${farm.name} » (${reset.tombstones} sync deletions, ${reset.users} made-up users), deleted ${companies.map((c) => `« ${c.name} »`).join(", ") || "no company"}; ${rows} rows of the history imported`] };
}
