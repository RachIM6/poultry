// What the phone's screens need from documents, without Zod (ADR-009).
export { FILE_TYPES, MAX_FILE_BYTES, checkFile } from "@/modules/documents/domain/file";
export type { FileType } from "@/modules/documents/domain/file";

/** DC2: what an upload is for. A proof photo is every member's; a vault document only the owner's and manager's. */
export const FILE_PURPOSES = ["proof", "document"] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];
