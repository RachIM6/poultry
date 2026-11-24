import { closeSync, openSync, unlinkSync, writeSync } from "node:fs";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/kernel/sheet";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { zipEnd, zipEntry } from "@/lib/zip";

// ADR-007, docs/data-requests.md: an organisation's data export and deletion, law 09-08. Operator tools (ADR-006: admin
// tools that cross module boundaries are separate and logged), run from scripts/; every run writes an AuditEvent.
// Every table must be listed below: export and deletion refuse to run on a table nobody has classified.

/**
 * Kept read-only after a deletion: the books and their supporting documents (law 9-88 art. 22: ten years; decided default,
 * docs/data-requests.md). Their counterparties' and employees' phones are erased (SCRUB); StoredFile keeps the receipts.
 */
export const KEPT = [
  "LegalEntity",
  ...["JournalEntry", "JournalLine", "PostingOverride", "LockedPeriod", "FiscalYearClose"],
  ...["TreasuryAccount", "TreasuryTransfer", "BankStatement", "BankStatementLine", "BankMatch", "ManualEntry", "Expense"],
  ...["FixedAsset", "Loan", "LoanInstallment", "Subsidy", "SubsidyAsset", "YearEndCount", "YearEndValue", "HensSchedule"],
  ...["Supplier", "Purchase", "StockItem", "SupplierPayment", "IssuedDebit", "Batch"],
  ...["Buyer", "Sale", "SaleLine", "BuyerPayment", "InstrumentStatus"],
  ...["Employee", "SalaryAdvance", "LabourRules", "PayMonth", "PayPayment"],
];

/** Deleted 30 days after the organisation left. `PARTLY` keeps some of their rows. */
export const DELETED = [
  ...["Farm", "House", "RegisterKeeper", "Membership", "Invitation", "Notification", "VaccinationProtocol", "Document", "DocumentReminder"],
  ...["Mutation", "SyncVersion", "Change", "AuditEvent", "StoredFile", "PostingCursor", "ThresholdAlert", "FrozenAllocation", "FrozenBatch", "Budget"],
  ...["StockMovement", "DailyEntry", "Weighing", "SoldBirds", "BatchCost", "Vaccination", "Treatment", "VetVisit"],
  ...["EggCollection", "EggGrading", "EggDiscard", "EggDraw", "PriceObservation", "PlannedBatch", "DowntimeRule"],
  ...["Routine", "OneOffTask", "TaskDone", "TaskAssignment", "Attendance", "StaffRecord", "ClimateTargetSet", "ClimateReading", "PowerCut"],
  ...["Visit", "Disposal", "ManureRemoval", "Cleanout", "RodentCheck"],
];

/** The operator's own events (this file) stay: they are the record that a request was handled. */
const OPERATOR_ACTIONS = ["export", "left", "rejoined", "delete"];
const PARTLY: Record<string, string> = {
  StoredFile: `AND "purpose" <> 'receipt'`, // receipts are supporting documents of kept entries
  AuditEvent: `AND NOT ("entity" = 'Organization' AND "action" IN (${OPERATOR_ACTIONS.map((a) => `'${a}'`).join(", ")}))`,
};

/** Personal data kept tables don't need: set to null on deletion. */
const SCRUB: Record<string, string[]> = { Buyer: ["phone"], Supplier: ["phone"], Employee: ["phone", "userId"] };

/** No organizationId, reached through a parent: exported with the organisation. Users are its members. */
const THROUGH_PARENT: Record<string, string> = {
  Organization: `"id" = $1::uuid`,
  User: `"id" IN (SELECT "userId" FROM "Membership" WHERE "organizationId" = $1::uuid)`,
  CleanoutStep: `"cleanoutId" IN (SELECT "id" FROM "Cleanout" WHERE "organizationId" = $1::uuid)`,
};

/**
 * No organizationId and not the organisation's: the catalogue and charts (global), login secrets (never exported) and a
 * member's own settings and login log (deleted with the member: deleteOrganization).
 */
const NOT_ORGANIZATION_DATA = [
  ...["Strain", "StandardCurve", "StandardPoint", "LayingCurve", "LayingPoint", "Product", "EggGrade", "ProtocolTemplate", "LedgerAccount"],
  ...["Session", "Account", "Verification", "RateLimitHit", "CaptchaUse", "AuthEvent", "PushSubscription", "NotificationPreference"],
  "_prisma_migrations",
];

type Column = { name: string; type: string };

/** Every public table and its columns, from the catalogue, checked against the lists above. */
async function tables(): Promise<Map<string, Column[]>> {
  const rows = await db.$queryRaw<{ table: string; name: string; type: string }[]>`
    SELECT table_name AS "table", column_name AS name, data_type AS type FROM information_schema.columns
    WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
  const all = new Map<string, Column[]>();
  for (const r of rows) all.set(r.table, [...(all.get(r.table) ?? []), { name: r.name, type: r.type }]);
  const listed = new Set([...KEPT, ...DELETED, ...Object.keys(THROUGH_PARENT), ...NOT_ORGANIZATION_DATA]);
  const scoped = new Set([...KEPT, ...DELETED]);
  for (const [table, columns] of all) {
    const hasOrg = columns.some((c) => c.name === "organizationId");
    if (!listed.has(table) || hasOrg !== scoped.has(table)) throw new Error(`table ${table} is not classified: add it to src/ops/organization-data.ts and docs/data-requests.md`);
  }
  for (const t of listed) if (!all.has(t)) throw new Error(`table ${t} is listed in src/ops/organization-data.ts but does not exist`);
  return all;
}

const operator = () => process.env.OPERATOR ?? process.env.USER ?? process.env.USERNAME ?? null;
const auditOperator = (organizationId: string, action: string, after: object) =>
  db.auditEvent.create({ data: { organizationId, entity: "Organization", entityId: organizationId, action, after: { ...after, operator: operator() } } });

export type ExportSummary = { tables: number; rows: number; files: number; bytes: number };

/**
 * One .zip of everything the organisation has: `tables/<Table>.json` and `.csv` for every table with its rows (bytes
 * columns left out), `files/<id>.<ext>` for every StoredFile, and `manifest.json`. Written to `out` entry by entry.
 */
// ponytail: one table's rows and one file in memory at a time, so memory is the largest table (Change or AuditEvent)
// plus 5 MB; the zip has no zip64, so at most 4 GB and 65,535 entries (files at the 2 GB storage cap fit). Page the
// big tables, or add zip64, when an organisation gets near that.
export async function exportOrganization(organizationId: string, out: string): Promise<ExportSummary> {
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error(`no organisation ${organizationId}`);
  const all = await tables();
  const fd = openSync(out, "wx"); // never overwrite an earlier export
  const centrals: Buffer[] = [];
  let offset = 0;
  const add = (name: string, data: string | Uint8Array) => {
    const { local, central } = zipEntry(name, data, offset);
    writeSync(fd, local);
    centrals.push(central);
    offset += local.length;
    if (offset > 0xffffffff || centrals.length > 0xffff) throw new Error("the export is past the zip limits (4 GB, 65,535 entries)");
  };
  try {
    const counts: Record<string, number> = {};
    for (const [table, columns] of all) {
      const where = THROUGH_PARENT[table] ?? (columns.some((c) => c.name === "organizationId") ? `"organizationId" = $1::uuid` : null);
      if (!where) continue;
      const binary = columns.filter((c) => c.type === "bytea").map((c) => `'${c.name}'`);
      const text = columns.filter((c) => c.type !== "bytea");
      // Postgres writes both: exact bigints and dates, nothing goes through a JS number. Names come from the catalogue.
      const json = binary.length ? `to_jsonb(t) - ARRAY[${binary.join(", ")}]` : "to_jsonb(t)";
      const rows = await db.$queryRawUnsafe<{ json: string; cells: (string | null)[] }[]>(
        `SELECT (${json})::text AS json, ARRAY[${text.map((c) => `t."${c.name}"::text`).join(", ")}] AS cells FROM "${table}" t WHERE ${where}`,
        organizationId,
      );
      counts[table] = rows.length;
      add(`tables/${table}.json`, `[\n${rows.map((r) => r.json).join(",\n")}\n]\n`);
      add(`tables/${table}.csv`, toCsv({ name: table, header: text.map((c) => c.name), rows: rows.map((r) => r.cells.map((c) => c ?? "")) }));
    }
    const files = await db.storedFile.findMany({ where: { organizationId }, select: { id: true, contentType: true }, orderBy: { id: "asc" } });
    for (const f of files) {
      const { bytes } = await db.storedFile.findUniqueOrThrow({ where: { id: f.id }, select: { bytes: true } });
      add(`files/${f.id}.${f.contentType.split("/")[1]}`, bytes);
    }
    add("manifest.json", JSON.stringify({ organizationId, name: org.name, exportedAt: new Date().toISOString(), rows: counts, files: files.length }, null, 2));
    for (const b of zipEnd(centrals, offset)) writeSync(fd, b);
    closeSync(fd);
    const summary = { tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), files: files.length, bytes: offset };
    await auditOperator(organizationId, "export", summary);
    return summary;
  } catch (e) {
    closeSync(fd);
    unlinkSync(out); // no half-written export left behind
    throw e;
  }
}

/** Marks the organisation as left now (or `at`), or, with null, as back. Its deletion may run 30 days after `leftAt`. */
export async function markOrganizationLeft(organizationId: string, at: Date | null): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: organizationId }, data: { leftAt: at } });
    await tx.auditEvent.create({
      data: { organizationId, entity: "Organization", entityId: organizationId, action: at ? "left" : "rejoined", after: { leftAt: at, operator: operator() } },
    });
  });
}

export const DELETION_GRACE_DAYS = 30;

export type DeletionSummary = { deleted: Record<string, number>; scrubbed: Record<string, number>; users: number; kept: Record<string, number> };

/**
 * ADR-007 as amended (docs/data-requests.md): deletes every table in DELETED and the members who belong to no other
 * organisation (with their sessions, push subscriptions, codes and login log), erases phones in kept tables, and keeps
 * the books and the organisation row they hang on. Never touches the ledger, so its immutability triggers stay on.
 * Refused unless the organisation left 30 days ago or more and `confirmName` is its exact name.
 */
export async function deleteOrganization(
  organizationId: string,
  confirmName: string,
  now = new Date(),
): Promise<Result<DeletionSummary, "NOT_FOUND" | "NOT_LEFT" | "TOO_SOON" | "WRONG_NAME">> {
  await tables();
  return db.$transaction(
    async (tx) => {
      const [org] = await tx.$queryRaw<{ name: string; leftAt: Date | null }[]>`
        SELECT name, "leftAt" FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
      if (!org) return fail("NOT_FOUND");
      if (!org.leftAt) return fail("NOT_LEFT");
      if (now.getTime() - org.leftAt.getTime() < DELETION_GRACE_DAYS * 86_400_000) return fail("TOO_SOON");
      if (confirmName !== org.name) return fail("WRONG_NAME");

      const members = (await tx.membership.findMany({ where: { organizationId }, select: { userId: true } })).map((m) => m.userId);
      const deleted: Record<string, number> = {};
      for (const table of DELETED) {
        deleted[table] = await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1::uuid ${PARTLY[table] ?? ""}`, organizationId);
      }
      const scrubbed: Record<string, number> = {};
      for (const [table, columns] of Object.entries(SCRUB)) {
        const set = columns.map((c) => `"${c}" = NULL`).join(", ");
        const any = columns.map((c) => `"${c}" IS NOT NULL`).join(" OR ");
        scrubbed[table] = await tx.$executeRawUnsafe(`UPDATE "${table}" SET ${set} WHERE "organizationId" = $1::uuid AND (${any})`, organizationId);
      }

      // Members of no other organisation: the person goes, with what is theirs alone. Sessions and accounts cascade.
      const gone = await tx.user.findMany({ where: { id: { in: members }, memberships: { none: {} } }, select: { id: true, phoneNumber: true } });
      const ids = gone.map((u) => u.id);
      const phones = gone.flatMap((u) => (u.phoneNumber ? [u.phoneNumber] : []));
      await tx.verification.deleteMany({ where: { identifier: { in: phones } } });
      await tx.authEvent.deleteMany({ where: { userId: { in: ids } } });
      await tx.pushSubscription.deleteMany({ where: { userId: { in: ids } } });
      await tx.notificationPreference.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });

      const kept: Record<string, number> = {};
      for (const table of KEPT) {
        const [{ n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE "organizationId" = $1::uuid`, organizationId);
        kept[table] = Number(n);
      }
      const summary = { deleted, scrubbed, users: ids.length, kept };
      await tx.auditEvent.create({
        data: { organizationId, entity: "Organization", entityId: organizationId, action: "delete", after: { ...summary, leftAt: org.leftAt, operator: operator() } },
      });
      return ok(summary);
    },
    { timeout: 10 * 60_000, maxWait: 10_000 }, // one transaction: all of it or nothing, however many rows
  );
}
