import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "@/modules/documents/shared";

export * from "@/modules/documents/shared";

// SPEC-m2-compliance DC1: the vault's records, written offline like every farm record; the file comes later (DC2).
const optional = (max: number) => z.string().trim().min(1).max(max).nullable();

export const DocumentFields = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.enum(DOCUMENT_CATEGORIES),
  farmId: z.uuid().nullable(),
  issuedOn: z.iso.date().nullable(),
  expiresOn: z.iso.date().nullable(),
  notes: optional(500),
});
export type DocumentFields = z.infer<typeof DocumentFields>;

export const CreateDocument = DocumentFields.extend({ id: z.uuid() });
// Field by field, last write received wins, like farms (ADR-003 §5).
export const UpdateDocument = z.object({ id: z.uuid(), changes: DocumentFields.partial().refine((c) => Object.keys(c).length > 0, "no change") });
