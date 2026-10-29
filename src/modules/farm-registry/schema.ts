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

// Farms and houses (SPEC F2–F4): written offline, so these schemas run on the phone and in the sync push alike.

const text = (max: number) => z.string().trim().min(1).max(max);

export const FarmFields = z.object({
  name: text(120),
  region: text(80),
  province: text(80),
  commune: text(80),
  gps: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable(),
  onssa: z.object({ number: text(40), expiresOn: z.iso.date() }).nullable(), // ONSSA authorization
});
export type FarmFields = z.infer<typeof FarmFields>;

export const HOUSE_TYPES = ["open", "closed"] as const;
export const HouseFields = z.object({
  name: text(80),
  areaM2: z.int().min(1).max(1_000_000),
  capacity: z.int().min(1).max(10_000_000), // birds
  type: z.enum(HOUSE_TYPES),
});
export type HouseFields = z.infer<typeof HouseFields>;

// An update carries only the fields the user changed: concurrent edits of different fields both survive, and the
// same field converges to the last write the server receives (ADR-003 §5).
const changes = <T extends z.ZodRawShape>(fields: z.ZodObject<T>) =>
  fields.partial().refine((c) => Object.keys(c).length > 0, "no change");

export const CreateFarm = FarmFields.extend({ id: z.uuid() });
export const UpdateFarm = z.object({ id: z.uuid(), changes: changes(FarmFields) });
export const CreateHouse = HouseFields.extend({ id: z.uuid(), farmId: z.uuid() });
export const UpdateHouse = z.object({ id: z.uuid(), changes: changes(HouseFields) });

/** What pull returns and the phone stores. */
export type FarmDto = { id: string } & FarmFields;
export type HouseDto = { id: string; farmId: string } & HouseFields;

export const FARM_MUTATIONS = {
  createFarm: "farm-registry.createFarm",
  updateFarm: "farm-registry.updateFarm",
  createHouse: "farm-registry.createHouse",
  updateHouse: "farm-registry.updateHouse",
} as const;
