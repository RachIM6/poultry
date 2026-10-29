// Public API of the `farm-registry` module (see CAPABILITY-MAP.md). Other modules import only from here.
export { accountingProfileOf, LEGAL_FORMS, parseOnboarding } from "./schema";
export type { AccountingProfile, LegalForm, OnboardingInput } from "./schema";
export { createOrganization, getLegalEntity, listLegalEntities } from "./service";
export type { LegalEntityDto } from "./service";
