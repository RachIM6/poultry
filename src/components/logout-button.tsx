"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { postJson } from "@/lib/api";
import { secondary } from "@/components/ui";

/** `everywhere`: also logs out every other phone of this user (a lost phone, T25 S2). `className`: the header menu's items. */
export function LogoutButton({ everywhere = false, className = secondary }: { everywhere?: boolean; className?: string }) {
  const t = useTranslations("Account");
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        if (everywhere && !confirm(t("everywhereConfirm"))) return;
        const { currentScope, localDb, signOutLocally } = await import("@/offline/db"); // Dexie stays off /more's first load
        // poultry-auth §3: unsent changes are kept, but the user must know before leaving.
        const scope = await currentScope();
        if (scope && (await localDb(scope).outbox.count()) > 0 && !confirm(t("unsyncedConfirm"))) return;
        // A shared phone must stop receiving this user's pushes: the server forgets this endpoint, and the phone unsubscribes.
        const push = await navigator.serviceWorker
          ?.getRegistration()
          .then((reg) => reg?.pushManager?.getSubscription())
          .catch(() => null); // never blocks logging out
        await postJson(everywhere ? "/api/auth/logout?everywhere" : "/api/auth/logout", { endpoint: push?.endpoint });
        if (scope) await signOutLocally(scope);
        await push?.unsubscribe().catch(() => {});
        router.replace("/login");
      }}
      className={className}
    >
      {t(everywhere ? "logoutEverywhere" : "logout")}
    </button>
  );
}
