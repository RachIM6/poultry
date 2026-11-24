"use client";

import { useTranslations } from "next-intl";
import { primary } from "@/components/ui";

// What a signed-in screen shows when it throws, mostly an online form whose send failed (no network, the server down):
// said plainly, with a retry, instead of Next's bare "Application error". The nav stays (it is in the layout above).
export default function AppError({ retry }: { retry: () => void }) {
  const t = useTranslations("Offline");
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-3.5 px-6 pb-8 pt-24">
      <p role="alert" className="text-lg font-semibold">{t("failed")}</p>
      <button type="button" onClick={retry} className={primary}>{t("retry")}</button>
    </main>
  );
}
