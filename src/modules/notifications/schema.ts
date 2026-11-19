import { z } from "zod";

// SPEC N1–N3. Isomorphic: the inbox screen reads these on the phone.

/** Message keys under Notifications.templates in ar.json / fr.json. Modules add theirs here (low stock, vaccines…). */
export const TEMPLATE_KEYS = ["test", "lowStock", "vaccineTomorrow", "vaccineToday"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type NotificationDto = {
  id: string;
  userId: string;
  templateKey: TemplateKey;
  params: Record<string, string>; // already formatted (Western digits, DH…): the template only inserts them
  urgent: boolean;
  createdAt: string;
  readAt: string | null;
};

export const MarkRead = z.object({ id: z.uuid() });
export const NOTIFICATION_MUTATIONS = { markRead: "notifications.markRead" } as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const QuietHoursInput = z.object({ start: hhmm, end: hhmm });

// The server posts to the endpoint a browser gives it, so only HTTPS URLs of the browsers' push services are kept:
// anything else would let a client make the server call an arbitrary URL (SSRF).
const PUSH_SERVICES = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
export const PushSubscriptionInput = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((u) => {
      const url = new URL(u);
      return url.protocol === "https:" && !url.port && PUSH_SERVICES.some((host) => host.test(url.hostname));
    }, "not a known push service"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
