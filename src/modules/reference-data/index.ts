// Public API of the `reference-data` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for the isomorphic schemas and the curve lookup the offline client needs (ADR-008).
export { areVaccines, getReferenceData, isCatalogueProduct, isStrain, ownProtocol, productNames } from "./service";
export { referenceDataSync } from "./sync";
