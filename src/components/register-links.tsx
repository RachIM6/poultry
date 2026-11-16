"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** SPEC-m2-compliance RP2: a batch's register in either language, from the batch screen. Its own file, so the batch
 * screen doesn't load the register builder. */
export function RegisterLinks({ batchId }: { batchId: string }) {
  const t = useTranslations();
  return (
    <span className="flex gap-4">
      {(["fr", "ar"] as const).map((l) => (
        <Link key={l} href={`/register#${batchId}`} locale={l} className="py-2 underline underline-offset-4">
          {t("Register.link", { language: t(`LocaleSwitcher.${l}`) })}
        </Link>
      ))}
    </span>
  );
}
