import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { postEntry } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";
import { purgeExpired, purgeExpiredDaily } from "./retention";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe("retention purge (ADR-007, docs/data-requests.md)", () => {
  let a: TenantContext, b: TenantContext;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [a, b] = await twoTenants();
    const [entity] = await listLegalEntities(a);
    const posted = await db.$transaction((tx) =>
      postEntry(tx, a, {
        id: uuidv7(),
        legalEntityId: entity.id,
        journal: "AC",
        label: "Aliment",
        reversesId: null,
        day: "2019-03-10" as FarmDay,
        lines: [
          { account: "612122", debit: 450_000n, credit: 0n },
          { account: "4411", debit: 0n, credit: 450_000n },
        ],
      }),
    );
    expect(posted.ok).toBe(true);
    await db.auditEvent.updateMany({ where: { entity: "JournalEntry" }, data: { serverReceivedAt: ago(20 * 365) } }); // the ledger's own audit: very old

    const authEvent = (at: Date) => db.authEvent.create({ data: { action: "login", at } }).then((r) => r.id);
    ids.authOld = await authEvent(ago(366));
    ids.authNew = await authEvent(ago(300));

    await db.rateLimitHit.createMany({ data: [{ key: "requestCode:phone:86400:old", at: ago(2) }, { key: "requestCode:phone:86400:new", at: ago(0.5) }] });

    const session = (expiresAt: Date) => db.session.create({ data: { token: uuidv7(), userId: a.userId, expiresAt } }).then((r) => r.id);
    ids.sessionOld = await session(ago(1));
    ids.sessionNew = await session(ago(-30));
    const code = (expiresAt: Date) => db.verification.create({ data: { identifier: "+212600000001", value: "x", expiresAt } }).then((r) => r.id);
    ids.codeOld = await code(ago(1 / 24));
    ids.codeNew = await code(ago(-1 / 24));
    // ADR-015: reset codes and invitations (with their invite code), past their 7 days.
    const reset = (expiresAt: Date) => db.passwordReset.create({ data: { userId: a.userId, codeHash: uuidv7(), expiresAt } }).then((r) => r.id);
    ids.resetOld = await reset(ago(1));
    ids.resetNew = await reset(ago(-6));
    const invitation = (phoneNumber: string, expiresAt: Date) =>
      db.invitation.create({ data: { organizationId: a.organizationId, phoneNumber, role: "worker", invitedById: a.userId, codeHash: uuidv7(), expiresAt } }).then((r) => r.id);
    ids.invitationOld = await invitation("+212650000001", ago(1));
    ids.invitationNew = await invitation("+212650000002", ago(-6));

    const notification = (ctx: TenantContext, createdAt: Date, readAt: Date | null) =>
      db.notification
        .create({ data: { organizationId: ctx.organizationId, userId: ctx.userId, templateKey: "loanDue", params: {}, deliverAfter: createdAt, createdAt, readAt } })
        .then((r) => r.id);
    ids.readOld = await notification(a, ago(100), ago(91));
    ids.readNew = await notification(a, ago(100), ago(80));
    ids.unreadOld = await notification(a, ago(366), null);
    ids.unreadNew = await notification(a, ago(300), null);
    ids.otherOrgRecent = await notification(b, ago(10), ago(5));

    const audit = (ctx: TenantContext, entity: string, days: number) =>
      db.auditEvent
        .create({ data: { organizationId: ctx.organizationId, entity, entityId: uuidv7(), action: "create", serverReceivedAt: ago(days) } })
        .then((r) => r.id);
    ids.visitOld = await audit(a, "Visit", 5 * 366);
    ids.visitNew = await audit(a, "Visit", 4 * 365);
    ids.visitOtherOrg = await audit(b, "Visit", 30);
    ids.saleOld = await audit(a, "Sale", 20 * 365); // a supporting document's audit: kept with the books
    ids.unknownOld = await audit(a, "sale", 20 * 365); // an entity not on the farm list: kept
  });

  it("purges what is past its period, keeps the rest, and leaves the books alone", async () => {
    const journal = { entries: await db.journalEntry.count(), lines: await db.journalLine.count() };
    const ledgerAudit = await db.auditEvent.count({ where: { entity: "JournalEntry" } });

    const summary = await purgeExpired();

    expect(summary).toEqual({
      deleted: { AuthEvent: 1, RateLimitHit: 1, Session: 1, Verification: 1, PasswordReset: 1, Invitation: 1, AuditEvent: 1, Notification: 2 },
      complete: true,
    });
    const left = async <T extends { id: string }>(find: Promise<T[]>) => (await find).map((r) => r.id).sort();
    const sorted = (...xs: string[]) => xs.sort();
    expect(await left(db.authEvent.findMany())).toEqual([ids.authNew]);
    expect((await db.rateLimitHit.findMany()).map((h) => h.key)).toEqual(["requestCode:phone:86400:new"]);
    expect(await left(db.session.findMany())).toEqual([ids.sessionNew]);
    expect(await left(db.verification.findMany())).toEqual([ids.codeNew]);
    expect(await left(db.passwordReset.findMany())).toEqual([ids.resetNew]);
    expect(await left(db.invitation.findMany())).toEqual([ids.invitationNew]);
    expect(await left(db.notification.findMany())).toEqual(sorted(ids.readNew, ids.unreadNew, ids.otherOrgRecent));
    expect(await db.auditEvent.findUnique({ where: { id: ids.visitOld } })).toBeNull();
    for (const kept of [ids.visitNew, ids.visitOtherOrg, ids.saleOld, ids.unknownOld]) expect(await db.auditEvent.findUnique({ where: { id: kept } })).not.toBeNull();

    // The books: entries, lines and their audit untouched.
    expect({ entries: await db.journalEntry.count(), lines: await db.journalLine.count() }).toEqual(journal);
    expect(journal.entries).toBe(1);
    expect(await db.auditEvent.count({ where: { entity: "JournalEntry" } })).toBe(ledgerAudit);

    // Phones drop the purged notifications: a deletion in the sync log of their organisation, none in the other's.
    const tombstones = (await db.change.findMany({ where: { entity: "notification" } })).filter((c) => c.data === null);
    expect(tombstones.map((c) => [c.organizationId, c.entityId]).sort()).toEqual([[a.organizationId, ids.readOld], [a.organizationId, ids.unreadOld]].sort());
    expect(await db.change.count({ where: { organizationId: b.organizationId, entity: "notification" } })).toBe(0);
  });

  it("is idempotent: a second run deletes nothing", async () => {
    expect(await purgeExpired()).toEqual({
      deleted: { AuthEvent: 0, RateLimitHit: 0, Session: 0, Verification: 0, PasswordReset: 0, Invitation: 0, AuditEvent: 0, Notification: 0 },
      complete: true,
    });
  });

  it("works in batches and stops at its time budget, leaving the rest for the next run", async () => {
    await db.authEvent.createMany({ data: Array.from({ length: 2_500 }, () => ({ action: "login", at: ago(400) })) });

    expect(await purgeExpired(undefined, 0)).toMatchObject({ deleted: { AuthEvent: 0 }, complete: false });
    expect((await purgeExpired()).deleted.AuthEvent).toBe(2_500);
    expect(await db.authEvent.count()).toBe(1);
  });

  it("runs once a day from the scheduler and logs counts only", async () => {
    await db.authEvent.create({ data: { action: "login", at: ago(400), phone: "+2126•••••12" } });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    expect(await purgeExpiredDaily()).toMatchObject({ deleted: { AuthEvent: 1 } });
    expect(await purgeExpiredDaily()).toBeNull();

    expect(log.mock.calls).toEqual([
      [JSON.stringify({ level: "info", retention: { AuthEvent: 1, RateLimitHit: 0, Session: 0, Verification: 0, PasswordReset: 0, Invitation: 0, AuditEvent: 0, Notification: 0 }, complete: true })],
    ]);
    log.mockRestore();
  });
});
