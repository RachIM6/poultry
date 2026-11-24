// What the phone's screens need from documents, without Zod (ADR-009).
export { FILE_TYPES, MAX_FILE_BYTES, checkFile } from "@/modules/documents/domain/file";
export type { FileType } from "@/modules/documents/domain/file";

/**
 * DC2: what an upload is for. A proof photo is every member's; a vault document only the owner's and manager's; an
 * expense receipt (SPEC-finance FN10) only theirs too, as the expense.
 */
export const FILE_PURPOSES = ["proof", "document", "receipt"] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export { DOCUMENT_CATEGORIES, DOCUMENT_SOON_DAYS, byExpiry, documentState } from "@/modules/documents/domain/document";
export type { DocumentCategory, DocumentState } from "@/modules/documents/domain/document";
import type { DocumentCategory } from "@/modules/documents/domain/document";

/** DC1: what pull returns to owners and managers only. `fileId`: the scan, attached online after the record. */
export type DocumentDto = {
  id: string;
  title: string;
  category: DocumentCategory;
  farmId: string | null; // null: the organisation as a whole
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  fileId: string | null;
};

export const DOCUMENT_MUTATIONS = { createDocument: "documents.createDocument", updateDocument: "documents.updateDocument" } as const;
