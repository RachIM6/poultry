import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { changeRole, logoutEverywhere, removeMember, requestCode, verifyCode } from "@/modules/identity";
import { dispatchDuePushes, forgetPushSubscriptions, notificationsSync as registry, notify, savePushSubscription, setQuietHours, type PushSender } from "@/modules/notifications";
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

  it("never sends a notification with an amount to someone who can no longer see money (T25 S5)", async () => {
    const manager = { ...worker, role: "manager" as const };
    await db.$transaction((tx) =>
      notify(tx, owner, { userIds: [manager.userId], templateKey: "instrumentDue", params: { amount: "9 000,00 DH" }, urgency: "normal" }, night),
    );
    const keys = (ctx: TenantContext) => pull(ctx, 0, registry).then((p) => p.changes.map((c) => (c.data as { templateKey: string }).templateKey));
    expect(await keys(manager)).toContain("instrumentDue");
    expect(await keys(worker)).not.toContain("instrumentDue"); // the same person, demoted to worker
    await db.notification.deleteMany({ where: { templateKey: "instrumentDue" } }); // not due for the dispatch test below
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

// Security audit: a push reaches only someone who still has access, and only what their current role may see.
describe("pushes after access ends", () => {
  const sent: { endpoint: string; title: string }[] = [];
  const send: PushSender = async (target, payload) => void sent.push({ endpoint: target.endpoint, title: JSON.parse(payload).title });
  let org: TenantContext;
  const member = async (phone: string, role: "worker" | "manager" | "accountant", accessUntil?: string) => {
    const user = await db.user.create({ data: { phoneNumber: phone, name: phone, email: `${phone.slice(1)}@phone.invalid`, locale: "fr" } });
    const m = await db.membership.create({ data: { organizationId: org.organizationId, userId: user.id, role, accessUntil: accessUntil && new Date(`${accessUntil}T00:00:00Z`) } });
    return { userId: user.id, membershipId: m.id };
  };
  const subscribe = async (userId: string, n: number) => expect((await savePushSubscription(userId, { endpoint: endpoint(n), keys })).ok).toBe(true);
  const subscriptionsOf = (userId: string) => db.pushSubscription.count({ where: { userId } });

  beforeAll(async () => {
    org = await tenant("+212660000010");
  });

  it("sends nothing to a removed member or a partner past their end day, and no amount to a demoted manager", async () => {
    const removed = await member("+212660000011", "worker");
    const partner = await member("+212660000012", "accountant", "2026-03-31"); // night is 2026-04-01
    const demoted = await member("+212660000013", "manager");
    for (const [userId, n] of [[removed.userId, 11], [partner.userId, 12], [demoted.userId, 13], [org.userId, 14]] as const) await subscribe(userId, n);
    const everyone = [removed.userId, partner.userId, demoted.userId, org.userId];
    await db.$transaction((tx) => notify(tx, org, { userIds: everyone, templateKey: "test", urgency: "urgent" }, night));
    await db.$transaction((tx) => notify(tx, org, { userIds: everyone, templateKey: "loanDue", params: { amount: "1 000,00 DH" }, urgency: "urgent" }, night));
    await db.membership.delete({ where: { id: removed.membershipId } });
    await db.membership.update({ where: { id: demoted.membershipId }, data: { role: "worker" } });

    sent.length = 0;
    await dispatchDuePushes(render, send, night);
    expect(sent.map((s) => `${s.endpoint} ${s.title}`).sort()).toEqual([`${endpoint(13)} fr:test`, `${endpoint(14)} fr:loanDue`, `${endpoint(14)} fr:test`]);
    sent.length = 0;
    await dispatchDuePushes(render, send, night); // the skipped ones were claimed too: never sent later
    expect(sent).toEqual([]);
  });

  it("log out everywhere forgets the user's push subscriptions with their sessions", async () => {
    await requestCode("0660000014", {}); // a manager who lost a phone
    const code = (await db.verification.findFirstOrThrow({ where: { identifier: "phone-number-otp-+212660000014" } })).value.split(":")[0];
    const res = await verifyCode("0660000014", code, "fr", {});
    if (!res.ok) throw new Error(res.error);
    const userId = (await db.user.findUniqueOrThrow({ where: { phoneNumber: "+212660000014" } })).id;
    await db.membership.create({ data: { organizationId: org.organizationId, userId, role: "manager" } });
    await subscribe(userId, 15);
    await subscribe(org.userId, 16);
    await logoutEverywhere(new Headers({ cookie: res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ") }), forgetPushSubscriptions);
    expect(await subscriptionsOf(userId)).toBe(0);
    expect(await subscriptionsOf(org.userId)).toBe(2); // someone else's stay
  });

  it("removing someone's last membership forgets their subscriptions; another membership or a role change keeps them", async () => {
    const other = await tenant("+212660000020");
    const solo = await member("+212660000021", "worker");
    const twice = await member("+212660000022", "worker");
    await db.membership.create({ data: { organizationId: other.organizationId, userId: twice.userId, role: "worker" } });
    await subscribe(solo.userId, 21);
    await subscribe(twice.userId, 22);

    expect(await changeRole(org, { membershipId: solo.membershipId, role: "manager" })).toEqual({ ok: true, value: undefined });
    expect(await subscriptionsOf(solo.userId)).toBe(1);
    expect(await removeMember(org, { membershipId: twice.membershipId }, forgetPushSubscriptions)).toEqual({ ok: true, value: undefined });
    expect(await subscriptionsOf(twice.userId)).toBe(1); // still a member of the other farm
    expect(await removeMember(org, { membershipId: solo.membershipId }, forgetPushSubscriptions)).toEqual({ ok: true, value: undefined });
    expect(await subscriptionsOf(solo.userId)).toBe(0);
  });
});
