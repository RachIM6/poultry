import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { POLICIES } from "@/lib/security/policies";
import { recordChange } from "@/lib/sync/server";

// Law 09-08 art. 3-1-e: personal data is kept no longer than its purpose needs. The periods are decided defaults, to
// review (ADR-007, docs/data-requests.md "Retention periods"). Not purged here: the books and their supporting
// documents (law 9-88 art. 22), the audit of anything that is not on FARM_AUDIT below, and the sync log (`Change`:
// pulls and finance's posting sources depend on it, ADR-014).

/**
 * Audit events of farm operations that are neither books nor supporting documents nor inputs to the postings, purged
 * after AUDIT_YEARS. Exact `entity` strings as written by audit(); an entity not listed here is kept with the books.
 */
export const FARM_AUDIT = [
  ...["Farm", "House", "Membership", "Invitation", "Session", "Document", "PlannedBatch", "DowntimeRule", "Budget", "PriceObservation"],
  ...["Visit", "Disposal", "ManureRemoval", "Cleanout", "CleanoutStep", "RodentCheck", "VaccinationProtocol", "VaccinationPlan", "VetVisit"],
  ...["Weighing", "Routine", "OneOffTask", "TaskDone", "TaskAssignment", "StaffRecord", "ClimateTargetSet", "ClimateReading", "PowerCut"],
];
const AUDIT_YEARS = 5;

/** Rate-limit hits count only inside their window: older than the longest window, they can no longer block anyone. */
const LONGEST_WINDOW_SEC = Math.max(...Object.values(POLICIES).flat().map((r) => r.windowSec));

// Table names and conditions are constants; $1 is always `now`.
const RULES: { table: string; where: string; params?: unknown[] }[] = [
  { table: "AuthEvent", where: `"at" < $1::timestamptz - interval '12 months'` },
  { table: "RateLimitHit", where: `"at" < $1::timestamptz - make_interval(secs => ${LONGEST_WINDOW_SEC})` },
  { table: "Session", where: `"expiresAt" < $1::timestamptz` },
  { table: "Verification", where: `"expiresAt" < $1::timestamptz` },
  { table: "PasswordReset", where: `"expiresAt" < $1::timestamptz` }, // ADR-015: an expired reset code opens nothing
  { table: "Invitation", where: `"expiresAt" < $1::timestamptz` }, // nor an expired invitation (its code, its phone)
  {
    table: "AuditEvent",
    where: `"serverReceivedAt" < $1::timestamptz - make_interval(years => ${AUDIT_YEARS}) AND "entity" = ANY($2::text[])`,
    params: [FARM_AUDIT],
  },
];
const BATCH = 1_000;
const NOTIFICATION_BATCH = 100; // each takes a sync version: keep the organisation's counter locked briefly

export type PurgeSummary = { deleted: Record<string, number>; complete: boolean };

/**
 * Deletes what has outlived its retention period, in batches, until done or `budgetMs` has passed (the rest waits for
 * the next run). Idempotent: every batch is a fresh "older than" delete. Never touches the books.
 */
export async function purgeExpired(clock: Clock = systemClock, budgetMs = 10_000): Promise<PurgeSummary> {
  const now = clock.now();
  const deadline = Date.now() + budgetMs;
  const deleted: Record<string, number> = {};
  let complete = true;
  // Batches until one comes back short (nothing left) or time is up; a table cut short by time counts as not done.
  const drain = async (table: string, batch: number, run: () => Promise<number>) => {
    deleted[table] = 0;
    let n = batch;
    while (n === batch && Date.now() < deadline) {
      n = await run();
      deleted[table] += n;
    }
    if (n === batch) complete = false;
  };
  for (const { table, where, params = [] } of RULES) {
    const sql = `DELETE FROM "${table}" WHERE ctid = ANY(ARRAY(SELECT ctid FROM "${table}" WHERE ${where} LIMIT ${BATCH}))`;
    await drain(table, BATCH, () => db.$executeRawUnsafe(sql, now, ...params));
  }
  await drain("Notification", NOTIFICATION_BATCH, () => purgeNotifications(now));
  return { deleted, complete };
}

/**
 * Read notifications 90 days old, and any notification a year old. Phones hold a copy (the inbox syncs), so each one
 * leaves a deletion in the sync log: phones drop it, and a new phone's snapshot (ADR-014) no longer brings it back.
 */
async function purgeNotifications(now: Date): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; organizationId: string }[]>`
      DELETE FROM "Notification" WHERE id IN (
        SELECT id FROM "Notification"
        WHERE "readAt" < ${now}::timestamptz - interval '90 days' OR "createdAt" < ${now}::timestamptz - interval '1 year'
        ORDER BY id LIMIT ${NOTIFICATION_BATCH} FOR UPDATE SKIP LOCKED)
      RETURNING id, "organizationId"`;
    for (const r of rows) await recordChange(tx, r, "notification", r.id, null);
    return rows.length;
  });
}

/**
 * The scheduler step (/api/push/dispatch, every minute): runs the purge once a day. The first dispatcher of the day
 * takes a marker under the limiter's lock (rate_limit_consume, migration *_rate_limit_function); every other run skips
 * without scanning anything. Logs counts only.
 */
// ponytail: a backlog bigger than one run's budget clears over the following days. Run it again the same day if one appears.
export async function purgeExpiredDaily(clock: Clock = systemClock): Promise<PurgeSummary | null> {
  const [{ hits }] = await db.$queryRaw<{ hits: number }[]>`
    SELECT hits FROM rate_limit_consume('retention', ARRAY['retention:run:86400'], ARRAY[86400])`;
  if (hits > 0) return null;
  const summary = await purgeExpired(clock);
  console.info(JSON.stringify({ level: "info", retention: summary.deleted, complete: summary.complete }));
  return summary;
}
