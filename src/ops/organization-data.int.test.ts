import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { storeFile } from "@/modules/documents";
import { DELETED, KEPT, deleteOrganization, exportOrganization, markOrganizationLeft } from "@/ops/organization-data";
import { twoTenants } from "@/test/tenant";
import { unzipBytes } from "@/test/unzip";

const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, 0x00, 0xff, 0xfe, n]);
const DAY = 86_400_000;

/** A few rows in representative tables: farm data, personal data, the books, files, a child table, the member's login. */
async function seed(ctx: TenantContext, n: number) {
  const org = { organizationId: ctx.organizationId };
  const phone = (await db.user.findUniqueOrThrow({ where: { id: ctx.userId } })).phoneNumber!;
  const entity = await db.legalEntity.findFirstOrThrow({ where: org });
  const ids = { farm: uuidv7(), visit: uuidv7(), buyer: uuidv7(), employee: uuidv7(), cleanout: uuidv7(), step: uuidv7(), entry: uuidv7(), expense: uuidv7() };
  await db.farm.create({ data: { id: ids.farm, ...org, name: `Ferme ${n}`, region: "Souss-Massa", province: "Agadir", commune: "Drarga" } });
  await db.visit.create({
    data: { id: ids.visit, ...org, farmId: ids.farm, enteredAt: new Date(), visitor: `Visiteur ${n}`, purpose: "vet", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "clean", recordedBy: ctx.userId },
  });
  await db.buyer.create({ data: { id: ids.buyer, ...org, name: `Acheteur ${n}`, phone: `+21266000000${n}`, type: "trader" } });
  await db.employee.create({
    data: { id: ids.employee, ...org, farmId: ids.farm, name: `Ouvrier ${n}`, job: "worker", phone: `+21267000000${n}`, housedOnFarm: false, startedOn: new Date("2026-01-01"), dailyWageCentimes: 10_000n },
  });
  await db.cleanout.create({
    data: { id: ids.cleanout, ...org, farmId: ids.farm, houseId: uuidv7(), afterBatchId: uuidv7(), startedOn: new Date("2026-02-01"), startedBy: ctx.userId, steps: { create: { id: ids.step, step: "manureOut", day: new Date("2026-02-01"), recordedBy: ctx.userId } } },
  });
  await db.journalEntry.create({
    data: {
      id: ids.entry, ...org, legalEntityId: entity.id, journal: "OD", day: new Date("2026-03-01"), label: `Écriture ${n}`, createdBy: ctx.userId,
      lines: { create: [{ ...org, account: "5161", debitCentimes: 12_345n }, { ...org, account: "7111", creditCentimes: 12_345n }] },
    },
  });
  const proof = await storeFile(ctx, "proof", png(n));
  const receipt = await storeFile(ctx, "receipt", png(n + 100));
  if (!proof.ok || !receipt.ok) throw new Error("storeFile");
  await db.expense.create({ data: { id: ids.expense, ...org, day: new Date("2026-03-01"), category: "electricity", amountCentimes: 5_000n, paidFrom: "cash", receiptFileId: receipt.value.id, recordedBy: ctx.userId } });
  await db.invitation.create({ data: { ...org, phoneNumber: `+21265000000${n}`, role: "worker", invitedById: ctx.userId, expiresAt: new Date(Date.now() + DAY) } });
  await db.session.create({ data: { token: `token-${n}`, userId: ctx.userId, expiresAt: new Date(Date.now() + DAY) } });
  await db.pushSubscription.create({ data: { userId: ctx.userId, endpoint: `https://push.example/${n}`, p256dh: "k", auth: "a" } });
  await db.authEvent.create({ data: { action: "login", userId: ctx.userId } });
  await db.verification.create({ data: { identifier: phone, value: "123456:0", expiresAt: new Date(Date.now() + DAY) } });
  return { ...ids, proof: proof.value.id, receipt: receipt.value.id };
}

const count = async (table: string, organizationId: string) =>
  Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE "organizationId" = $1::uuid`, organizationId))[0].n);
const counts = async (organizationId: string) => Object.fromEntries(await Promise.all([...KEPT, ...DELETED].map(async (t) => [t, await count(t, organizationId)])));
const ledger = async (organizationId: string) => ({
  entries: await db.journalEntry.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
  lines: await db.journalLine.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
});

describe("organisation export and deletion (ADR-007, law 09-08)", () => {
  let a: TenantContext, b: TenantContext;
  let seedA: Awaited<ReturnType<typeof seed>>, seedB: Awaited<ReturnType<typeof seed>>;
  let both: string; // a worker member of both organisations

  beforeAll(async () => {
    [a, b] = await twoTenants();
    seedA = await seed(a, 1);
    seedB = await seed(b, 2);
    both = (await db.user.create({ data: { phoneNumber: "+212600000003", name: "Deux", email: "212600000003@phone.invalid" } })).id;
    await db.membership.createMany({ data: [a, b].map((t) => ({ organizationId: t.organizationId, userId: both, role: "worker" as const })) });
  });

  it("exports every row of A as JSON and CSV, its files byte for byte, and nothing of B", async () => {
    const before = { Farm: await count("Farm", a.organizationId), Visit: await count("Visit", a.organizationId), JournalLine: await count("JournalLine", a.organizationId), AuditEvent: await count("AuditEvent", a.organizationId) };
    const out = join(tmpdir(), `org-export-${uuidv7()}.zip`);
    const summary = await exportOrganization(a.organizationId, out);
    const files = unzipBytes(readFileSync(out));
    const json = (t: string) => JSON.parse(files.get(`tables/${t}.json`)!.toString("utf8")) as Record<string, unknown>[];

    for (const [t, n] of Object.entries(before)) expect(json(t)).toHaveLength(n);
    expect(json("Farm").map((r) => r.id)).toEqual([seedA.farm]);
    expect(json("Visit")[0]).toMatchObject({ id: seedA.visit, visitor: "Visiteur 1" });
    expect(json("CleanoutStep").map((r) => r.id)).toEqual([seedA.step]); // a child without organizationId, through its parent
    expect(json("Organization").map((r) => r.id)).toEqual([a.organizationId]);
    expect(json("User").map((r) => r.id).sort()).toEqual([a.userId, both].sort());
    expect(json("JournalLine").map((r) => r.debitCentimes).sort()).toEqual([0, 12345]); // exact integers from Postgres
    expect(json("StoredFile")[0]).not.toHaveProperty("bytes");
    expect(files.get("tables/Visit.csv")!.toString("utf8").split("\r\n").filter(Boolean)).toHaveLength(2); // header + 1 row
    expect(files.has("tables/Session.json")).toBe(false); // login secrets are never exported

    for (const id of [seedA.proof, seedA.receipt]) {
      const row = await db.storedFile.findUniqueOrThrow({ where: { id } });
      expect(createHash("sha256").update(files.get(`files/${id}.png`)!).digest("hex")).toBe(row.sha256);
    }

    const everything = [...files.values()].map((f) => f.toString("latin1")).join("\n");
    for (const id of [b.organizationId, b.userId, ...Object.values(seedB)]) expect(everything).not.toContain(id);
    expect(everything).not.toContain("Visiteur 2");

    expect(summary.files).toBe(2);
    expect(await db.auditEvent.count({ where: { organizationId: a.organizationId, entity: "Organization", action: "export" } })).toBe(1);
  });

  it("refuses a deletion before the organisation left, before 30 days, and with the wrong name", async () => {
    const now = new Date();
    expect(await deleteOrganization(a.organizationId, "Ferme A", now)).toEqual({ ok: false, error: "NOT_LEFT" });
    await markOrganizationLeft(a.organizationId, new Date(now.getTime() - 29 * DAY));
    expect(await deleteOrganization(a.organizationId, "Ferme A", now)).toEqual({ ok: false, error: "TOO_SOON" });
    await markOrganizationLeft(a.organizationId, new Date(now.getTime() - 30 * DAY));
    expect(await deleteOrganization(a.organizationId, "Ferme B", now)).toEqual({ ok: false, error: "WRONG_NAME" });
    expect(await deleteOrganization(a.organizationId, "ferme a", now)).toEqual({ ok: false, error: "WRONG_NAME" });
    expect(await deleteOrganization(uuidv7(), "Ferme A", now)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await count("Visit", a.organizationId)).toBe(1); // nothing deleted
  });

  it("deletes A's personal and farm data, keeps its books unchanged, and leaves B untouched", async () => {
    const booksBefore = await ledger(a.organizationId);
    const bBefore = await counts(b.organizationId);
    const bLedgerBefore = await ledger(b.organizationId);

    const r = await deleteOrganization(a.organizationId, "Ferme A");
    expect(r.ok).toBe(true);

    for (const t of DELETED.filter((t) => t !== "StoredFile" && t !== "AuditEvent")) expect([t, await count(t, a.organizationId)]).toEqual([t, 0]);
    expect(await db.cleanoutStep.count({ where: { id: seedA.step } })).toBe(0);
    expect((await db.storedFile.findMany({ where: { organizationId: a.organizationId }, select: { id: true } })).map((f) => f.id)).toEqual([seedA.receipt]);
    const events = await db.auditEvent.findMany({ where: { organizationId: a.organizationId }, select: { entity: true, action: true } });
    expect(events.every((e) => e.entity === "Organization" && ["export", "left", "delete"].includes(e.action))).toBe(true);
    expect(events.filter((e) => e.action === "delete")).toHaveLength(1);

    // The owner, a member of A only, is gone with their login; the worker of both stays, a member of B.
    expect(await db.user.findUnique({ where: { id: a.userId } })).toBeNull();
    expect(await db.session.count({ where: { userId: a.userId } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { userId: a.userId } })).toBe(0);
    expect(await db.authEvent.count({ where: { userId: a.userId } })).toBe(0);
    expect(await db.verification.count({ where: { identifier: "+212600000001" } })).toBe(0);
    expect((await db.membership.findMany({ where: { userId: both } })).map((m) => m.organizationId)).toEqual([b.organizationId]);

    // The books and their supporting documents stay, phones erased.
    expect(await ledger(a.organizationId)).toEqual(booksBefore);
    expect(await db.expense.count({ where: { id: seedA.expense } })).toBe(1);
    expect(await db.buyer.findUniqueOrThrow({ where: { id: seedA.buyer } })).toMatchObject({ name: "Acheteur 1", phone: null });
    expect(await db.employee.findUniqueOrThrow({ where: { id: seedA.employee } })).toMatchObject({ name: "Ouvrier 1", phone: null, userId: null });
    expect(await db.organization.findUnique({ where: { id: a.organizationId } })).toMatchObject({ name: "Ferme A" });
    expect(await db.legalEntity.count({ where: { organizationId: a.organizationId } })).toBe(1);

    expect(await counts(b.organizationId)).toEqual(bBefore);
    expect(await ledger(b.organizationId)).toEqual(bLedgerBefore);
    expect(await db.user.count({ where: { id: b.userId } })).toBe(1);
    expect(await db.session.count({ where: { userId: b.userId } })).toBe(1);
    expect(await db.buyer.findUniqueOrThrow({ where: { id: seedB.buyer } })).toMatchObject({ phone: "+212660000002" });
  });
});
