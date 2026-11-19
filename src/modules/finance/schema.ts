import { z } from "zod";

// ADR-010 §2. Also imported by prisma/seed.ts under plain Node: no "@/" imports here.
export const CHARTS = ["cgnc", "pca", "coop"] as const; // no "coop" account is seeded until FQ2 gives its list: nothing posts
export type Chart = (typeof CHARTS)[number];

export const AccountRow = z.object({
  chart: z.enum(CHARTS),
  number: z.string().regex(/^[1-8]\d{0,7}$/),
  label: z.string().trim().min(1).max(200), // French, as printed in the source (Arabic labels: FQ12)
  parent: z.string().regex(/^[1-8]\d{0,7}$/).nullable(),
  // An overlay account's base-chart account, used when the overlay is off (SPEC-finance FN2's "CGNC parent" column).
  // Not always the tree parent: 612123 sits under 61212 → 6121 in the PCA, but posts to 6122 without it.
  fallback: z.string().regex(/^[1-8]\d{0,7}$/).nullable().default(null),
});
export type AccountRow = z.infer<typeof AccountRow>;

/** prisma/seed/finance/accounts.json: every account cites its source document (ADR-010: no number is invented). */
export const AccountsFile = z
  .object({ sources: z.partialRecord(z.enum(CHARTS), z.string().min(1)), accounts: z.array(AccountRow).min(1) })
  .refine((f) => f.accounts.every((a) => f.sources[a.chart]), "every chart used needs its source");
