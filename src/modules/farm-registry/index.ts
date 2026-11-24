// Public API of the `farm-registry` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for the isomorphic schemas the offline client needs (ADR-008).
export { accountingProfileOf, ALLOCATION_KEYS, BOOKS, booksAllowed, HENS_METHODS, LEGAL_FORMS, parseOnboarding } from "./schema";
export type { AccountingChoices, AccountingProfile, AllocationKey, Books, HensMethod, LegalForm, LegalIds, OnboardingInput } from "./schema";
export { createOrganization, getLegalEntity, legalEntityIn, legalIds, listLegalEntities, saveAccountingChoices, saveLegalIds } from "./service";
export type { LegalEntityDto } from "./service";
export { farmBelongsTo, farmRegistrySync, farmsWithHouses, houseOf, housesOf, onssaAuthorizationsDueBy, placeNames } from "./sync";
