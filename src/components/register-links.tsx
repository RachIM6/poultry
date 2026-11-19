"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** SPEC-m2-compliance RP2, RP3: a batch's register in either language and, for those who see money, its report.
 * Its own file, so the batch screen doesn't load the builders. */
export function RegisterLinks({ batchId, report }: { batchId: string; report: boolean }) {
  const t = useTranslations();
  return (
    <span className="flex gap-4">
      {(["fr", "ar"] as const).map((l) => (
        <Link key={l} href={`/register#${batchId}`} locale={l} className="py-2 underline underline-offset-4">
          {t("Register.link", { language: t(`LocaleSwitcher.${l}`) })}
        </Link>
      ))}
      {report && (
        <Link href={`/report?batch=${batchId}`} className="py-2 underline underline-offset-4">
          {t("Report.link")}
        </Link>
      )}
    </span>
  );
}
