import { z } from "zod";
import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC F1. Same values as the LegalForm enum in prisma/schema.prisma.
export const LEGAL_FORMS = ["individual", "indivision", "company", "cooperative", "association", "gie"] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

export const BOOKS = ["cash_book", "ledger"] as const;
export type Books = (typeof BOOKS)[number];

/**
 * ADR-010 §2: which books Dawra shows and exports, and the chart = one base + overlays. The engine is the same
 * double-entry ledger for every form. `coOwnerShares`: results are split between the co-owners of an indivision.
 */
export type AccountingProfile = { books: Books; base: "cgnc" | "coop"; overlays: "pca"[]; coOwnerShares: boolean };

/** The owner's choices, stored on the legal entity; null keeps the default of the form. */
export type AccountingChoices = { books: Books | null; pcaOverlay: boolean | null };

// ⚠️ ADR-010 is "proposed": to be reviewed by a Moroccan expert-comptable (FQ1 PCA mandatory?, FQ2 cooperative chart).
const DEFAULTS: Record<LegalForm, Omit<AccountingProfile, "coOwnerShares">> = {
  individual: { books: "cash_book", base: "cgnc", overlays: ["pca"] }, // below 5 M DH: a receipts-and-expenses book
  indivision: { books: "cash_book", base: "cgnc", overlays: ["pca"] },
  company: { books: "ledger", base: "cgnc", overlays: ["pca"] }, // CGNC, law 9-88; PCA, CNC opinion n° 7 (2015)
  gie: { books: "ledger", base: "cgnc", overlays: ["pca"] },
  // Law 112-12 requires the cooperative chart (arrêté 441-01), whose account list we don't have (FQ2): until then the
  // cooperative's accountant keeps its legal books, Dawra feeds them through the export, and the screens say so.
  cooperative: { books: "cash_book", base: "cgnc", overlays: ["pca"] },
  association: { books: "cash_book", base: "cgnc", overlays: [] }, // no associations chart decided yet
};

export const accountingProfileOf = (form: LegalForm, choices: AccountingChoices = { books: null, pcaOverlay: null }): AccountingProfile => {
  const d = DEFAULTS[form];
  const pca = choices.pcaOverlay ?? d.overlays.includes("pca");
  return { books: choices.books ?? d.books, base: d.base, overlays: pca ? ["pca"] : [], coOwnerShares: form === "indivision" };
};

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
  areaM2: z.int32().min(1).max(1_000_000),
  capacity: z.int32().min(1).max(10_000_000), // birds
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
