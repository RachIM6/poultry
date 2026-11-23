// Public API of the `farm-registry` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for the isomorphic schemas the offline client needs (ADR-008).
export { accountingProfileOf, BOOKS, booksAllowed, HENS_METHODS, LEGAL_FORMS, parseOnboarding } from "./schema";
export type { AccountingChoices, AccountingProfile, Books, HensMethod, LegalForm, OnboardingInput } from "./schema";
export { createOrganization, getLegalEntity, legalEntityIn, listLegalEntities, saveAccountingChoices } from "./service";
export type { LegalEntityDto } from "./service";
export { farmBelongsTo, farmRegistrySync, farmsWithHouses, houseOf, onssaAuthorizationsDueBy, placeNames } from "./sync";
