import { unlinkSync } from "node:fs";
import { db, type Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { PhoneNumber } from "@/modules/identity";
import { addTable, deleteUsers, operator, tables, writeZip, type Column } from "@/ops/organization-data";

// docs/data-requests.md: one member's own data, across organisations (law 09-08: access and erasure). Operator tools
// (ADR-006). Audited in the login log (AuthEvent, masked phone, no user id): a member's request is no single
// organisation's, and often comes from someone who no longer belongs to any.

/** Login secrets: never exported; they go with the user. */
const SECRETS = ["Session", "Account", "Verification"];
/** A column naming a user: userId, byUserId, recordedBy, invitedById… */
const namesUser = (c: Column) => c.type === "uuid" && /(^u|U)serId$|By(Id)?$/.test(c.name);

async function find(raw: string) {
  const phone = PhoneNumber.create(raw);
  if (!phone.ok) return null;
  const user = await db.user.findUnique({ where: { phoneNumber: phone.value.e164 }, select: { id: true, phoneNumber: true } });
  return user && { ...user, phone: phone.value };
}

const audit = (tx: Tx, action: "member_export" | "member_delete", phone: PhoneNumber) =>
  tx.authEvent.create({ data: { action, phone: phone.masked, reason: `operator:${operator() ?? "unknown"}` } });

export type MemberExportSummary = { tables: number; rows: number; bytes: number };

/**
 * One .zip of a member's own data, laid out like the organisation export: their User row, the invitations sent to their
 * number, and in every table the rows naming them (userId, …By, …ById): memberships, login log, devices, inbox, the
 * records they entered, the employee record linked to them. Never their sessions or codes.
 */
export async function exportMember(rawPhone: string, out: string): Promise<Result<MemberExportSummary, "NOT_FOUND">> {
  const user = await find(rawPhone);
  if (!user) return fail("NOT_FOUND");
  const all = await tables();
  const counts: Record<string, number> = {};
  const bytes = await writeZip(out, async (add) => {
    for (const [table, columns] of all) {
      if (SECRETS.includes(table)) continue;
      const where = [...columns.filter(namesUser).map((c) => `"${c.name}" = $1::uuid`), ...(table === "User" ? [`"id" = $1::uuid`] : [])];
      if (table === "Invitation") counts[table] = await addTable(add, table, columns, [...where, `"phoneNumber" = $2`].join(" OR "), [user.id, user.phoneNumber]);
      else if (where.length) counts[table] = await addTable(add, table, columns, where.join(" OR "), [user.id]);
    }
    add("manifest.json", JSON.stringify({ userId: user.id, phone: user.phoneNumber, exportedAt: new Date().toISOString(), rows: counts }, null, 2));
  });
  await audit(db, "member_export", user.phone).catch((e) => {
    unlinkSync(out); // every export handed over is audited
    throw e;
  });
  return ok({ tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), bytes });
}

export type MemberDeletionSummary = { memberships: number; invitations: number; notifications: number; employees: number; auditEvents: number };

/**
 * A member asks for deletion: their memberships everywhere, the invitations to their number, their inbox, then the user
 * with their sessions, codes, login log and devices (deleteUsers). As org:delete does, the employee record linked to them
 * stays for the books with its phone and user link erased, there and in the sync history; audit snapshots keep the
 * event with the phone masked. Records they entered keep their user id, which then names nobody. In one transaction.
 * Refused while they are the last owner of an organisation that hasn't left: no one would be left to run it.
 */
export async function deleteMember(
  rawPhone: string,
): Promise<Result<MemberDeletionSummary, "NOT_FOUND"> | { ok: false; error: "LAST_OWNER"; organizations: string[] }> {
  const user = await find(rawPhone);
  if (!user) return fail("NOT_FOUND");
  const { e164, masked } = user.phone;
  return db.$transaction(async (tx) => {
    const alone = await tx.membership.findMany({
      where: { userId: user.id, role: "owner", organization: { leftAt: null, memberships: { none: { role: "owner", userId: { not: user.id } } } } },
      select: { organization: { select: { name: true } } },
    });
    if (alone.length) return { ok: false as const, error: "LAST_OWNER" as const, organizations: alone.map((m) => m.organization.name) };

    const memberships = (await tx.membership.deleteMany({ where: { userId: user.id } })).count;
    const invitations = (await tx.invitation.deleteMany({ where: { phoneNumber: e164 } })).count;
    const notifications = (await tx.notification.deleteMany({ where: { userId: user.id } })).count;
    await tx.$executeRaw`DELETE FROM "Change" WHERE entity = 'notification' AND data->>'userId' = ${user.id}`; // their inbox's sync copies
    const employees = (await tx.employee.findMany({ where: { OR: [{ userId: user.id }, { phone: e164 }] }, select: { id: true } })).map((e) => e.id);
    await tx.employee.updateMany({ where: { id: { in: employees } }, data: { phone: null, userId: null } });
    await tx.$executeRaw`UPDATE "Change" SET data = data || '{"phone": null, "userId": null}'::jsonb
      WHERE entity = 'employee' AND "entityId" = ANY(${employees}::uuid[]) AND data IS NOT NULL`;
    const auditEvents = await tx.$executeRaw`UPDATE "AuditEvent"
      SET "before" = replace("before"::text, ${e164}, ${masked})::jsonb, "after" = replace("after"::text, ${e164}, ${masked})::jsonb
      WHERE strpos("before"::text, ${e164}) > 0 OR strpos("after"::text, ${e164}) > 0`;
    await deleteUsers(tx, [user]);
    await audit(tx, "member_delete", user.phone);
    return ok({ memberships, invitations, notifications, employees: employees.length, auditEvents });
  });
}
