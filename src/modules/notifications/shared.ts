// SPEC N1–N3, what the inbox screen reads on the phone, without Zod (ADR-009). The Zod schemas are in ./schema.ts,
// which re-exports this file.

/** Message keys under Notifications.templates in ar.json / fr.json. Modules add theirs here (low stock, vaccines…). */
export const TEMPLATE_KEYS = ["test", "lowStock", "vaccineTomorrow", "vaccineToday", "instrumentDue"] as const;
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

export const NOTIFICATION_MUTATIONS = { markRead: "notifications.markRead" } as const;
