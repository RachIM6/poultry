// OQ4, the official minimum. Arrêté n° 3308-17, art. 13 (docs/sources/onssa/ARR.3308-17.FR.txt): vaccination against
// Newcastle disease "est obligatoire pour les volailles et les oiseaux captifs" (art. 2: any bird kept for meat or eggs,
// so every production type), within the programme the DG of ONSSA validated for the farm. ONSSA publishes no programme
// (no ages, no strains): the app only warns when a protocol or a batch's plan has no Newcastle line, it never blocks.

/** The vaccines every protocol and every batch's plan must hold, by the catalogue's product id (prisma/seed/reference/products.json). */
export const REQUIRED_VACCINES = [{ disease: "newcastle", productId: "vaccine-newcastle", source: "Arrêté n° 3308-17, art. 13" }] as const;
export type RequiredVaccine = (typeof REQUIRED_VACCINES)[number];

/** The required vaccines with no line in a protocol's items or a batch's plan. */
export const missingRequiredVaccines = (lines: readonly { productId: string }[]): RequiredVaccine[] =>
  REQUIRED_VACCINES.filter((r) => !lines.some((l) => l.productId === r.productId));
