import webpush from "web-push";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { localesOf } from "@/modules/identity";
import {
  MarkRead,
  NOTIFICATION_MUTATIONS,
  PushSubscriptionInput,
  QuietHoursInput,
  type NotificationDto,
  type TemplateKey,
} from "@/modules/notifications/schema";
import { DEFAULT_QUIET_HOURS, deliverAfter, type QuietHours } from "@/modules/notifications/schedule";

type Row = { id: string; userId: string; templateKey: string; params: unknown; urgent: boolean; createdAt: Date; readAt: Date | null };
const toDto = (r: Row): NotificationDto => ({
  id: r.id,
  userId: r.userId,
  templateKey: r.templateKey as TemplateKey,
  params: r.params as Record<string, string>,
  urgent: r.urgent,
  createdAt: r.createdAt.toISOString(),
  readAt: r.readAt?.toISOString() ?? null,
});

/**
 * SPEC N3: the one way modules notify people. Runs in the caller's transaction: the inbox rows commit with the change
 * they announce, and push goes out after commit (dispatchDuePushes), held until the end of quiet hours unless urgent.
 * Recipients must be members of ctx's organisation: callers pass ids they got from it.
 */
export async function notify(
  tx: Tx,
  ctx: TenantContext,
  n: { userIds: string[]; templateKey: TemplateKey; params?: Record<string, string>; urgency: "normal" | "urgent" },
  clock: Clock = systemClock,
) {
  const urgent = n.urgency === "urgent";
  const prefs = await tx.notificationPreference.findMany({ where: { userId: { in: n.userIds } } });
  for (const userId of new Set(n.userIds)) {
    const pref = prefs.find((p) => p.userId === userId);
    const quiet: QuietHours = pref ? { start: pref.quietStart, end: pref.quietEnd } : DEFAULT_QUIET_HOURS;
    const row = await tx.notification.create({
      data: {
        organizationId: ctx.organizationId,
        userId,
        templateKey: n.templateKey,
        params: n.params ?? {},
        urgent,
        deliverAfter: deliverAfter(clock.now(), quiet, urgent),
      },
    });
    await recordChange(tx, ctx, "notification", row.id, toDto(row)); // the inbox syncs to the recipient's phones
  }
}

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushSender = (target: PushTarget, payload: string, urgent: boolean) => Promise<void>;
export type Render = (locale: "ar" | "fr", templateKey: string, params: Record<string, string>) => { title: string; body: string };

const vapid = () => {
  const [publicKey, privateKey, subject] = [process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY, process.env.VAPID_SUBJECT];
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
};

const webPushSender: PushSender = async (target, payload, urgent) => {
  const vapidDetails = vapid();
  if (!vapidDetails) return; // push not configured (VAPID keys): the inbox still has it
  await webpush.sendNotification(target, payload, { vapidDetails, TTL: 24 * 60 * 60, urgency: urgent ? "high" : "normal" });
};

/**
 * Sends every push that is due. Rows are claimed first (FOR UPDATE SKIP LOCKED), so two dispatchers never push the
 * same notification twice. Call it after the transaction that notified, and from a scheduler for held ones.
 */
// ponytail: a push that fails after its claim isn't retried; the inbox keeps the notification. Retry if pilots miss pushes.
export async function dispatchDuePushes(render: Render, send: PushSender = webPushSender, clock: Clock = systemClock): Promise<number> {
  const now = clock.now();
  const claimed = await db.$queryRaw<{ id: string; userId: string; templateKey: string; params: Record<string, string>; urgent: boolean }[]>`
    UPDATE "Notification" SET "pushedAt" = ${now}
    WHERE id IN (
      SELECT id FROM "Notification" WHERE "pushedAt" IS NULL AND "deliverAfter" <= ${now}
      ORDER BY "deliverAfter" LIMIT 500 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "userId", "templateKey", params, urgent`;
  if (claimed.length === 0) return 0;

  const userIds = [...new Set(claimed.map((n) => n.userId))];
  const [subscriptions, locales] = await Promise.all([db.pushSubscription.findMany({ where: { userId: { in: userIds } } }), localesOf(userIds)]);
  let sent = 0;
  for (const n of claimed) {
    const locale = locales.get(n.userId) ?? "ar";
    const payload = JSON.stringify({ ...render(locale, n.templateKey, n.params), url: `/${locale}/inbox` });
    for (const s of subscriptions.filter((s) => s.userId === n.userId)) {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, n.urgent);
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.pushSubscription.deleteMany({ where: { id: s.id } }); // unsubscribed
        else console.warn(`[push] ${status ?? "network"} error for one subscription`);
      }
    }
  }
  return sent;
}

/** N1. A browser's endpoint belongs to whoever signed in last on it (shared phones). */
export async function savePushSubscription(userId: string, raw: unknown): Promise<Result<void, "INVALID_INPUT">> {
  const input = PushSubscriptionInput.safeParse(raw);
  if (!input.success) return fail("INVALID_INPUT");
  const { endpoint, keys } = input.data;
  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
  });
  return ok(undefined);
}

export async function quietHoursOf(userId: string): Promise<QuietHours> {
  const pref = await db.notificationPreference.findUnique({ where: { userId } });
  return pref ? { start: pref.quietStart, end: pref.quietEnd } : DEFAULT_QUIET_HOURS;
}

/** N2: each user's own quiet hours. */
export async function setQuietHours(userId: string, raw: unknown): Promise<Result<void, "INVALID_INPUT">> {
  const input = QuietHoursInput.safeParse(raw);
  if (!input.success) return fail("INVALID_INPUT");
  const data = { quietStart: input.data.start, quietEnd: input.data.end };
  await db.notificationPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return ok(undefined);
}

export const notificationsSync: SyncRegistry = {
  mutations: {
    // A read receipt is the user's own interface state, not farm data: no audit event.
    [NOTIFICATION_MUTATIONS.markRead]: defineMutation({
      schema: MarkRead,
      action: "organization.read", // every member reads their own inbox
      async apply(tx, ctx, { id }) {
        const row = await tx.notification.findFirst({ where: { id, userId: ctx.userId, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        if (row.readAt) return ok(undefined);
        const updated = await tx.notification.update({ where: { id }, data: { readAt: new Date() } });
        await recordChange(tx, ctx, "notification", id, toDto(updated));
        return ok(undefined);
      },
    }),
  },
  // Everyone in the organisation shares one change log; each person only receives their own notifications.
  entities: { notification: (ctx, data: NotificationDto) => (data.userId === ctx.userId ? data : undefined) },
};
