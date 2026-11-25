import { useTranslations } from "next-intl";

// Dahir n° 1-75-292, art. 1 (docs/sources/onssa/DAH.1-75-292.FR.txt): the bird diseases that must be declared. Art. 3:
// whoever keeps or cares for a sick or suspect animal declares it at once, and so does any vet who sees it. Static
// text on the batch screen, for every role (the duty is the keeper's too); no workflow (SPEC-m2-compliance §1).
const DISEASES = ["hpai", "newcastle", "gumboro", "marek", "pullorum", "salmonella", "bronchitis", "tuberculosis", "psittacosis"] as const;

export function NotifiableDiseases() {
  const t = useTranslations("Notifiable");
  return (
    <details className="rounded-2xl border border-line bg-card p-3">
      <summary className="min-h-11 py-2.5 text-[17px] font-semibold text-ink-2">{t("title")}</summary>
      <ul className="list-disc ps-6">
        {DISEASES.map((d) => <li key={d}>{t(`diseases.${d}`)}</li>)}
      </ul>
      <p className="mt-2">{t("duty")}</p>
      <p className="mt-2 text-sm text-ink-2">{t("source")}</p>
    </details>
  );
}
