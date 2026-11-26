"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { wholeRegister } from "@/components/register-access";
import { link } from "@/components/ui";

/** SPEC-m2-compliance RP2, RP3: a batch's register in either language, on a phone that holds all of it, and, for those
 * who see money, its report. Its own file, so the batch screen doesn't load the builders. */
export function RegisterLinks({ batchId, scope }: { batchId: string; scope: TenantContext }) {
  const t = useTranslations();
  return (
    // UX review B2: in the batch's Page actions; a link never breaks inside, the row wraps between them on the phone.
    <span className="flex flex-wrap gap-x-4">
      {wholeRegister(scope) &&
        (["fr", "ar"] as const).map((l) => (
          <Link key={l} href={`/register#${batchId}`} locale={l} className={`${link} whitespace-nowrap`}>
            {t("Register.link", { language: t(`LocaleSwitcher.${l}`) })}
          </Link>
        ))}
      {can(scope, "money.read") && (
        <Link href={`/report?batch=${batchId}`} className={`${link} whitespace-nowrap`}>
          {t("Report.link")}
        </Link>
      )}
    </span>
  );
}
