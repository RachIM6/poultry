import { translatorFor } from "@/i18n/translator";
import type { Render } from "@/modules/notifications";

// Push texts in the recipient's language, from Notifications.templates.<key> in the message files.
export const render: Render = (locale, templateKey, params) => {
  const t = translatorFor(locale) as unknown as (key: string, values?: Record<string, string>) => string;
  return { title: t(`Notifications.templates.${templateKey}.title`, params), body: t(`Notifications.templates.${templateKey}.body`, params) };
};
