import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { deleteMember, exportMember } from "@/ops/member-data";
import { markOrganizationLeft } from "@/ops/organization-data";
import { tenant, twoTenants } from "@/test/tenant";
import { unzipBytes } from "@/test/unzip";

const DAY = 86_400_000;
const M = "+212600000003"; // the member who asks, in A and B
const N = "+212600000004"; // another member of A

/** A member of A (and of B when given) with their login, devices, inbox, an employee record and a record they entered. */
async function member(phone: string, name: string, a: TenantContext, farm: string, b?: TenantContext) {
  const user = await db.user.create({ data: { phoneNumber: phone, name, email: `${phone.slice(1)}@phone.invalid` } });
  const org = { organizationId: a.organizationId };
  await db.membership.createMany({ data: [{ ...org, userId: user.id, role: "worker" as const }, ...(b ? [{ organizationId: b.organizationId, userId: user.id, role: "manager" as const }] : [])] });
  await db.session.create({ data: { token: `token-${phone}`, userId: user.id, expiresAt: new Date(Date.now() + DAY) } });
  await db.authEvent.create({ data: { action: "login", userId: user.id } });
  await db.pushSubscription.create({ data: { userId: user.id, endpoint: `https://push.example/${phone}`, p256dh: "k", auth: "a" } });
  await db.notificationPreference.create({ data: { userId: user.id } });
  await db.verification.create({ data: { identifier: `phone-number-otp-${phone}`, value: "123456:0", expiresAt: new Date(Date.now() + DAY) } });
  const notification = await db.notification.create({ data: { ...org, userId: user.id, templateKey: "test", params: {}, deliverAfter: new Date() } });
  await db.change.create({ data: { ...org, version: BigInt(Date.now()) + BigInt(phone.slice(-1)), entity: "notification", entityId: notification.id, data: { userId: user.id } } });
  const employee = uuidv7();
  const dto = { id: employee, name: `Ouvrier ${name}`, phone, userId: user.id };
  await db.employee.create({ data: { id: employee, ...org, farmId: farm, name: dto.name, job: "worker", phone, userId: user.id, housedOnFarm: false, startedOn: new Date("2026-01-01"), dailyWageCentimes: 10_000n } });
  await db.change.create({ data: { ...org, version: BigInt(Date.now()) + 10n + BigInt(phone.slice(-1)), entity: "employee", entityId: employee, data: dto } });
  await db.auditEvent.create({ data: { ...org, userId: a.userId, entity: "Employee", entityId: employee, action: "create", after: dto } });
  const visit = uuidv7();
  await db.visit.create({
    data: { id: visit, ...org, farmId: farm, enteredAt: new Date(), visitor: `Visiteur ${name}`, purpose: "vet", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "clean", recordedBy: user.id },
  });
  return { id: user.id, employee, visit };
}

const personalRows = async (id: string, phone: string) => ({
  User: await db.user.count({ where: { id } }),
  Membership: await db.membership.count({ where: { userId: id } }),
  Session: await db.session.count({ where: { userId: id } }),
  AuthEvent: await db.authEvent.count({ where: { userId: id } }),
  PushSubscription: await db.pushSubscription.count({ where: { userId: id } }),
  NotificationPreference: await db.notificationPreference.count({ where: { userId: id } }),
  Notification: await db.notification.count({ where: { userId: id } }),
  Verification: await db.verification.count({ where: { identifier: { endsWith: phone } } }),
  Invitation: await db.invitation.count({ where: { phoneNumber: phone } }),
  Employee: await db.employee.count({ where: { OR: [{ userId: id }, { phone }] } }),
});

describe("a member's export and deletion (docs/data-requests.md)", () => {
  let a: TenantContext, b: TenantContext;
  let m: Awaited<ReturnType<typeof member>>, n: Awaited<ReturnType<typeof member>>;

  beforeAll(async () => {
    [a, b] = await twoTenants();
    const farm = uuidv7();
    await db.farm.create({ data: { id: farm, organizationId: a.organizationId, name: "Ferme", region: "Souss-Massa", province: "Agadir", commune: "Drarga" } });
    m = await member(M, "M", a, farm, b);
    n = await member(N, "N", a, farm);
    await db.invitation.create({ data: { organizationId: b.organizationId, phoneNumber: M, role: "worker", invitedById: b.userId, expiresAt: new Date(Date.now() + DAY) } });
  });

  it("exports only the member's own rows, never their sessions or codes", async () => {
    const out = join(tmpdir(), `member-export-${uuidv7()}.zip`);
    const r = await exportMember("06 00 00 00 03", out);
    const files = unzipBytes(readFileSync(out));
    rmSync(out);
    expect(r.ok).toBe(true);
    const json = (t: string) => JSON.parse(files.get(`tables/${t}.json`)!.toString("utf8")) as Record<string, unknown>[];

    const tables = [...files.keys()].filter((f) => f.endsWith(".json") && f !== "manifest.json").map((f) => f.slice(7, -5));
    for (const t of tables) for (const row of json(t)) expect([t, Object.values(row).some((v) => v === m.id || v === M)]).toEqual([t, true]);
    expect(json("User").map((u) => u.id)).toEqual([m.id]);
    expect(json("Membership").map((x) => x.organizationId).sort()).toEqual([a.organizationId, b.organizationId].sort());
    expect(json("Visit").map((v) => v.id)).toEqual([m.visit]);
    expect(json("Employee").map((e) => e.id)).toEqual([m.employee]);
    expect(json("Invitation")).toHaveLength(1);
    expect(["Session", "Account", "Verification"].filter((t) => files.has(`tables/${t}.json`))).toEqual([]);

    const everything = [...files.values()].map((f) => f.toString("utf8")).join("\n");
    for (const other of [n.id, N, n.visit, n.employee, "Visiteur N"]) expect(everything).not.toContain(other);
    expect(await db.authEvent.count({ where: { action: "member_export", phone: "+2126•••••03", userId: null } })).toBe(1);
  });

  it("refuses to delete the last owner of an organisation that hasn't left", async () => {
    const c = await tenant("+212600000005", "Ferme C");
    expect(await deleteMember("+212600000005")).toEqual({ ok: false, error: "LAST_OWNER", organizations: ["Ferme C"] });
    expect(await db.user.count({ where: { id: c.userId } })).toBe(1);
    await markOrganizationLeft(c.organizationId, new Date());
    expect((await deleteMember("+212600000005")).ok).toBe(true);
    expect(await deleteMember("+212600000005")).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await deleteMember("12345")).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("leaves no personal row for the member, keeps the books' records, and leaves another member untouched", async () => {
    const before = await personalRows(n.id, N);
    const r = await deleteMember(M);
    expect(r).toEqual({ ok: true, value: { memberships: 2, invitations: 1, notifications: 1, employees: 1, auditEvents: 1 } });

    expect(Object.values(await personalRows(m.id, M))).toEqual(Array(10).fill(0));
    expect(await db.employee.findUniqueOrThrow({ where: { id: m.employee } })).toMatchObject({ name: "Ouvrier M", phone: null, userId: null });
    expect(await db.visit.findUniqueOrThrow({ where: { id: m.visit } })).toMatchObject({ recordedBy: m.id }); // the record stays
    const copies = await db.change.findMany({ where: { OR: [{ entityId: m.employee }, { entity: "notification", data: { path: ["userId"], equals: m.id } }] } });
    expect(copies.map((c) => c.data)).toEqual([expect.objectContaining({ name: "Ouvrier M", phone: null, userId: null })]);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { entity: "Employee", entityId: m.employee } });
    expect(audit.after).toMatchObject({ phone: "+2126•••••03" });
    expect(JSON.stringify(await db.auditEvent.findMany())).not.toContain(M);
    expect(await db.authEvent.count({ where: { action: "member_delete", phone: "+2126•••••03", userId: null } })).toBe(1);

    expect(await personalRows(n.id, N)).toEqual(before);
    expect(before).toMatchObject({ User: 1, Membership: 1, Session: 1, AuthEvent: 1, Notification: 1, Verification: 1, Employee: 1 });
    expect(await db.employee.findUniqueOrThrow({ where: { id: n.employee } })).toMatchObject({ phone: N, userId: n.id });
    expect((await db.membership.findMany({ where: { organizationId: b.organizationId } })).map((x) => x.userId)).toEqual([b.userId]);
  });
});
