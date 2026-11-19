// SPEC-finance FN17, §7. Pure. The threshold and its rule are configuration with a validity date (FQ5): a change of
// law adds an entry, it never edits a past one.

export type Threshold = { validFrom: string; centimes: bigint; ruleFr: string; ruleAr: string; source: string };

// ⚠️ FQ5: the exact conditions (the 3-year rule) are to be confirmed with an expert-comptable before anyone relies on
// them. Sources: NEEDS-ANALYSIS.md §3 (CGI art. 47-I and 6-I-A-29°, DGI note on the 2026 finance law).
export const THRESHOLDS: readonly Threshold[] = [
  {
    validFrom: "2026-01-01",
    centimes: 500_000_000n, // 5 000 000,00 DH of agricultural revenue
    ruleFr:
      "Le revenu agricole est exonéré tant que le chiffre d’affaires agricole reste sous 5 000 000 DH (CGI art. 47-I ; sociétés : art. 6-I-A-29°, sans dépasser ce seuil 3 années de suite). Conditions exactes à confirmer avec votre expert-comptable.",
    ruleAr:
      "يُعفى الدخل الفلاحي ما دام رقم المعاملات الفلاحي أقل من 5.000.000 درهم (المدونة العامة للضرائب، المادة 47-I؛ الشركات: المادة 6-I-A-29°، دون تجاوز هذا السقف 3 سنوات متتالية). الشروط الدقيقة يجب تأكيدها مع خبيركم المحاسب.",
    source: "CGI art. 47-I, art. 6-I-A-29° (NEEDS-ANALYSIS.md §3)",
  },
];

/** The threshold in force on `day` (the latest one valid from it), or null before the first. */
export function thresholdOn(day: string, list: readonly Threshold[] = THRESHOLDS): Threshold | null {
  return [...list].filter((t) => t.validFrom <= day).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;
}

export const ALERT_PERCENT = 90n;

/** §7: (booked + planned) ÷ threshold, in whole percent rounded down; the alert from 90 %. */
export function thresholdUsage(bookedCentimes: bigint, plannedCentimes: bigint, thresholdCentimes: bigint) {
  const total = bookedCentimes + plannedCentimes;
  const percent = (total * 100n) / thresholdCentimes;
  return { totalCentimes: total, percent, alert: percent >= ALERT_PERCENT, over: total >= thresholdCentimes };
}
