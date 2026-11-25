import { useTranslations } from "next-intl";
import type { LegalForm, LegalIds } from "@/modules/farm-registry/schema";

/** F-Profile on the official statements: whose they are, with the registration numbers the owner gave (none: none shown). */
export function EntityHeader({ name, form, ids }: { name: string; form: LegalForm; ids: LegalIds | null }) {
  const t = useTranslations();
  const rc = ids?.rcNumber && (ids.rcCourt ? `${ids.rcNumber} · ${ids.rcCourt}` : ids.rcNumber);
  const rows = ([["ice", ids?.ice], ["fiscalId", ids?.fiscalId], ["rc", rc], ["cnss", ids?.cnssNumber]] as const).filter(([, v]) => v);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-lg font-semibold">
        {name} · {t(`Onboarding.forms.${form}`)}
      </p>
      {rows.length > 0 && (
        <dl aria-label={t("LegalIds.title")} className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {rows.map(([key, value]) => (
            <div key={key} className="flex gap-1.5">
              <dt className="text-ink-2">{t(`LegalIds.short.${key}`)}</dt>
              <dd dir="ltr">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
