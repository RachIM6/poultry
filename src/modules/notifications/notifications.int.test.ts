import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { dispatchDuePushes, notificationsSync as registry, notify, savePushSubscription, setQuietHours, type PushSender } from "@/modules/notifications";
import { NOTIFICATION_MUTATIONS as M } from "@/modules/notifications/schema";
import { tenant } from "@/test/tenant";

const night = fixedClock("2026-04-01T22:30:00Z"); // 23:30 on the farm, inside the default quiet hours
const morning = fixedClock("2026-04-02T05:00:00Z"); // 06:00: they end
const render = (locale: string, key: string) => ({ title: `${locale}:${key}`, body: "…" });
const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const keys = { p256dh: "BPub", auth: "auth" };

describe("notifications (SPEC N1–N3)", () => {
  let owner: TenantContext, worker: TenantContext;
  beforeAll(async () => {
    owner = await tenant("+212660000001");
    const user = await db.user.create({ data: { phoneNumber: "+212660000002", name: "w", email: "212660000002@phone.invalid", locale: "fr" } });
    await db.membership.create({ data: { organizationId: owner.organizationId, userId: user.id, role: "worker" } });
    worker = { userId: user.id, organizationId: owner.organizationId, role: "worker" };
  });

  it("holds a normal notification until each recipient's quiet hours end; an urgent one goes now", async () => {
    await setQuietHours(worker.userId, { start: "23:45", end: "05:00" }); // the worker's own window: 23:30 is still awake time
    await db.$transaction((tx) => notify(tx, owner, { userIds: [owner.userId, worker.userId], templateKey: "test", urgency: "normal" }, night));
    await db.$transaction((tx) => notify(tx, owner, { userIds: [owner.userId], templateKey: "test", urgency: "urgent" }, night));

    const rows = await db.notification.findMany({ orderBy: [{ urgent: "asc" }, { userId: "asc" }] });
    const byUser = (id: string, urgent: boolean) => rows.find((r) => r.userId === id && r.urgent === urgent)!.deliverAfter.toISOString();
    expect(byUser(owner.userId, false)).toBe("2026-04-02T05:00:00.000Z"); // default 22:00–06:00
    expect(byUser(worker.userId, false)).toBe("2026-04-01T22:30:00.000Z");
    expect(byUser(owner.userId, true)).toBe("2026-04-01T22:30:00.000Z");
  });

  it("puts each notification in its recipient's inbox only, and lets only them mark it read", async () => {
    const mine = (ctx: TenantContext) => pull(ctx, 0, registry).then((p) => p.changes.map((c) => c.data as { userId: string; id: string }));
    expect((await mine(worker)).every((n) => n.userId === worker.userId)).toBe(true);
    expect((await mine(owner)).every((n) => n.userId === owner.userId)).toBe(true);

    const [ownersOwn] = await mine(owner);
    const read = (ctx: TenantContext) =>
      push(ctx, [{ id: uuidv7(), type: M.markRead, payload: { id: ownersOwn.id }, createdAt: "2026-04-02T08:00:00Z" }], registry);
    expect((await read(worker)).results[0]).toMatchObject({ status: "rejected", messageKey: "errors.NOT_FOUND" });
    expect((await read(owner)).results[0]).toMatchObject({ status: "applied" });
    expect((await db.notification.findUniqueOrThrow({ where: { id: ownersOwn.id } })).readAt).not.toBeNull();
  });

  it("pushes only what is due, never twice even with two dispatchers, and forgets dead subscriptions", async () => {
    for (const [userId, n] of [[owner.userId, 1], [owner.userId, 2], [worker.userId, 3]] as const) {
      expect(await savePushSubscription(userId, { endpoint: endpoint(n), keys })).toEqual({ ok: true, value: undefined });
    }
    const sent: { endpoint: string; payload: string }[] = [];
    const send: PushSender = async (target, payload) => {
      if (target.endpoint === endpoint(2)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: target.endpoint, payload });
    };

    await Promise.all([dispatchDuePushes(render, send, night), dispatchDuePushes(render, send, night)]);
    // Due at 23:30: the worker's normal one and the owner's urgent one. The owner's normal one waits.
    expect(sent.map((s) => s.endpoint).sort()).toEqual([endpoint(1), endpoint(3)]);
    expect(JSON.parse(sent.find((s) => s.endpoint === endpoint(3))!.payload)).toEqual({ title: "fr:test", body: "…", url: "/fr/inbox" });
    expect(await db.pushSubscription.count({ where: { endpoint: endpoint(2) } })).toBe(0);

    sent.length = 0;
    await dispatchDuePushes(render, send, morning);
    expect(sent.map((s) => s.endpoint)).toEqual([endpoint(1)]); // the held one, at 06:00
    await dispatchDuePushes(render, send, morning);
    expect(sent).toHaveLength(1);
  });

  it("only accepts push endpoints of the browsers' push services, over HTTPS", async () => {
    for (const bad of ["http://fcm.googleapis.com/fcm/send/x", "https://169.254.169.254/latest", "https://localhost:3000/api", "https://evil.example/push", "https://fcm.googleapis.com:8443/x"]) {
      expect(await savePushSubscription(owner.userId, { endpoint: bad, keys }), bad).toEqual({ ok: false, error: "INVALID_INPUT" });
    }
    expect((await savePushSubscription(owner.userId, { endpoint: "https://web.push.apple.com/QGx", keys })).ok).toBe(true);
    expect(await setQuietHours(owner.userId, { start: "25:00", end: "06:00" })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
