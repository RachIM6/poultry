import { fail, ok, type Result } from "@/lib/kernel/result";

// SPEC-m2-compliance DC2, D4 (ADR-011): what the farm may upload. Proof photos and scanned documents only.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type FileType = (typeof FILE_TYPES)[number];

const starts = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The type is read from the file's own first bytes (magic numbers), never from its name or the client's header. */
export function checkFile(b: Uint8Array): Result<FileType, "FILE_TOO_LARGE" | "FILE_TYPE_NOT_ALLOWED"> {
  if (b.length > MAX_FILE_BYTES) return fail("FILE_TOO_LARGE");
  if (starts(b, ascii("%PDF-"))) return ok("application/pdf");
  if (starts(b, [0xff, 0xd8, 0xff])) return ok("image/jpeg");
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ok("image/png");
  if (starts(b, ascii("RIFF")) && starts(b, ascii("WEBP"), 8)) return ok("image/webp");
  return fail("FILE_TYPE_NOT_ALLOWED");
}
