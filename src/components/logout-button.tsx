"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { postJson } from "@/lib/api";

export function LogoutButton() {
  const t = useTranslations("Account");
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await postJson("/api/auth/logout");
        router.replace("/login");
      }}
      className="rounded-lg border border-current/30 px-4 py-3"
    >
      {t("logout")}
    </button>
  );
}
