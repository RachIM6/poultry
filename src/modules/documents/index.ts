// Public API of the `documents` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./shared for what the offline client needs (ADR-008, ADR-009).
export { attachDocumentFile, documentsSync, MAX_ORG_STORAGE_BYTES, readFile, sendDocumentReminders, sizeOfFiles, storeFile } from "./service";
