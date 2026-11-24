"use client";

import { unstable_rethrow } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

// The online-only forms (treasury, books, closing, loans, assets, budget, settings): no send while the phone is
// offline, and a send that fails on the way keeps the form as typed. Kept apart from local-screen.tsx, which pulls in
// the phone's database.

const onOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => (window.removeEventListener("online", notify), window.removeEventListener("offline", notify));
};
export const useOnline = () => useSyncExternalStore(onOnline, () => navigator.onLine, () => true);

/** Said next to an online form's button while it is disabled for want of a network. */
export function OfflineHint({ online }: { online: boolean }) {
  const t = useTranslations("Offline");
  return online ? null : <p className="text-sm text-ink-2">{t("online")}</p>;
}

/**
 * A server action that never answered (no network, the server down) becomes a refusal shown in the form, so what was
 * typed stays; Next's own redirects still go through.
 */
export const unsent = <T extends { messageKey?: string }>(sent: Promise<T>): Promise<T> =>
  sent.catch((error: unknown) => {
    unstable_rethrow(error);
    return { messageKey: "Offline.failed" } as T;
  });
