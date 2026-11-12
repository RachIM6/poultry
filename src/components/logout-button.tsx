"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { postJson } from "@/lib/api";
import { currentScope, localDb, signOutLocally } from "@/offline/db";

/** `everywhere`: also logs out every other phone of this user (a lost phone, T25 S2). */
export function LogoutButton({ everywhere = false }: { everywhere?: boolean }) {
  const t = useTranslations("Account");
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        if (everywhere && !confirm(t("everywhereConfirm"))) return;
        // poultry-auth §3: unsent changes are kept, but the user must know before leaving.
        const scope = await currentScope();
        if (scope && (await localDb(scope).outbox.count()) > 0 && !confirm(t("unsyncedConfirm"))) return;
        await postJson(everywhere ? "/api/auth/logout?everywhere" : "/api/auth/logout");
        if (scope) await signOutLocally(scope);
        // A shared phone must stop receiving this user's pushes; the server drops the endpoint at its next 410.
        const reg = await navigator.serviceWorker?.getRegistration();
        await (await reg?.pushManager?.getSubscription())?.unsubscribe().catch(() => {});
        router.replace("/login");
      }}
      className="rounded-lg border border-current/30 px-4 py-3"
    >
      {t(everywhere ? "logoutEverywhere" : "logout")}
    </button>
  );
}
