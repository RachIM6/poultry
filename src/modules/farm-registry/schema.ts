import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC F1. Same values as the LegalForm enum in prisma/schema.prisma.
export const LEGAL_FORMS = ["individual", "indivision", "company", "cooperative", "association", "gie"] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

/** What M2 finance needs to know: which chart of accounts, and whether results are split between co-owners. */
export type AccountingProfile = { chart: "cash_book" | "pcge" | "cooperative" | "association"; coOwnerShares: boolean };

// NEEDS-ANALYSIS.md §3, ⚠️ to be validated by a Moroccan accountant before M2 uses it.
const CHART: Record<LegalForm, AccountingProfile["chart"]> = {
  individual: "cash_book", // no CGNC obligation under the flat-rate regime
  indivision: "cash_book", // treated like individuals
  company: "pcge", // CGNC, law 9-88
  gie: "pcge", // CGNC, law 13-97
  cooperative: "cooperative", // cooperative chart of accounts, law 112-12 + arrêté 441-01
  association: "association", // association chart of accounts, CNC opinion n° 23 (2023)
};

export const accountingProfileOf = (form: LegalForm): AccountingProfile => ({
  chart: CHART[form],
  coOwnerShares: form === "indivision",
});

export type OnboardingInput = { name: string; form: LegalForm; locale: "ar" | "fr" };

const NAME_MAX = 120;

// ponytail: hand-written checks for 3 fields; move to Zod with the sync schemas (T8; a new dependency is "ask first").
export function parseOnboarding(body: unknown): Result<OnboardingInput, "INVALID_INPUT"> {
  const { name, form, locale } = (body ?? {}) as Record<string, unknown>;
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > NAME_MAX) return fail("INVALID_INPUT");
  if (!LEGAL_FORMS.includes(form as LegalForm)) return fail("INVALID_INPUT");
  if (locale !== "ar" && locale !== "fr") return fail("INVALID_INPUT");
  return ok({ name: trimmed, form: form as LegalForm, locale });
}
