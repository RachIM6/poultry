import { z } from "zod";
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

export const Onboarding = z.object({
  name: z.string().trim().min(1).max(120),
  form: z.enum(LEGAL_FORMS),
  locale: z.enum(["ar", "fr"]),
});
export type OnboardingInput = z.infer<typeof Onboarding>;

export function parseOnboarding(body: unknown): Result<OnboardingInput, "INVALID_INPUT"> {
  const parsed = Onboarding.safeParse(body);
  return parsed.success ? ok(parsed.data) : fail("INVALID_INPUT");
}
