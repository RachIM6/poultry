"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { postJson } from "@/lib/api";
import { currentScope, localDb, signOutLocally } from "@/offline/db";

export function LogoutButton() {
  const t = useTranslations("Account");
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        // poultry-auth §3: unsent changes are kept, but the user must know before leaving.
        const scope = await currentScope();
        if (scope && (await localDb(scope).outbox.count()) > 0 && !confirm(t("unsyncedConfirm"))) return;
        await postJson("/api/auth/logout");
        if (scope) await signOutLocally(scope);
        router.replace("/login");
      }}
      className="rounded-lg border border-current/30 px-4 py-3"
    >
      {t("logout")}
    </button>
  );
}
