// Public API of the `farm-registry` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for the isomorphic schemas the offline client needs (ADR-008).
export { accountingProfileOf, LEGAL_FORMS, parseOnboarding } from "./schema";
export type { AccountingProfile, LegalForm, OnboardingInput } from "./schema";
export { createOrganization, getLegalEntity, listLegalEntities } from "./service";
export type { LegalEntityDto } from "./service";
export { farmRegistrySync } from "./sync";
