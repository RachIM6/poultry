import { isSameOriginRequest } from "@/lib/security/csrf";
import { consume } from "@/lib/security/rate-limit";
import { z } from "zod";
import { attachRodentProof } from "@/modules/biosecurity";
import { attachDocumentFile, storeFile } from "@/modules/documents";
import { FILE_PURPOSES, MAX_FILE_BYTES, type FilePurpose } from "@/modules/documents/shared";
import { attachExpenseReceipt } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

const STATUS = { FORBIDDEN: 403, FILE_TOO_LARGE: 413, FILE_TYPE_NOT_ALLOWED: 415 } as const;
const error = (messageKey: string, status: number, headers?: HeadersInit) => Response.json({ ok: false, messageKey }, { status, headers });

// Each purpose's record: the query parameter naming it, and the module function attaching the file to it.
const TARGET = {
  proof: ["rodentCheck", attachRodentProof],
  document: ["document", attachDocumentFile],
  receipt: ["expense", attachExpenseReceipt],
} as const satisfies Record<FilePurpose, readonly [string, unknown]>;

// SPEC-m2-compliance DC2, ADR-011: POST ?purpose=document&document=<id> (DC1), ?purpose=proof&rodentCheck=<id> (BS8)
// or ?purpose=receipt&expense=<id> (SPEC-finance FN10), with the file itself as the body (no multipart), so the size is
// capped while reading. The type comes from the bytes (documents/domain/file.ts), not from the request. The file is
// attached to its record here, so a record only ever points at a file this organisation has just uploaded.
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return error("errors.FORBIDDEN", 403);
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return error("errors.UNAUTHENTICATED", 401);
  const query = new URL(req.url).searchParams;
  const purpose = query.get("purpose");
  if (!FILE_PURPOSES.includes(purpose as FilePurpose)) return error("errors.INVALID_INPUT", 400);
  const [param, attach] = TARGET[purpose as FilePurpose];
  const target = z.uuid().safeParse(query.get(param));
  if (!target.success) return error("errors.INVALID_INPUT", 400);
  if ((await consume("fileUpload", { user: ctx.value.userId })).length > 0) return error("errors.TOO_MANY_REQUESTS", 429, { "Retry-After": "3600" });
  const bytes = await readCapped(req, MAX_FILE_BYTES);
  if (bytes === null) return error("errors.FILE_TOO_LARGE", 413);
  const stored = await storeFile(ctx.value, purpose as FilePurpose, bytes);
  if (!stored.ok) return error(`errors.${stored.error}`, STATUS[stored.error]);
  // ponytail: two transactions; a refused attach leaves an unreferenced file behind (audited, never served to anyone
  // outside the organisation). One transaction if that ever matters.
  const attached = await attach(ctx.value, target.data, stored.value.id);
  if (!attached.ok) return error(`errors.${attached.error}`, attached.error === "NOT_FOUND" ? 404 : attached.error === "FORBIDDEN" ? 403 : 409);
  return Response.json({ ok: true, id: stored.value.id }, { status: 201 });
}

/** The body, or null past `max` bytes: stops reading there instead of buffering whatever the client sends. */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body) {
    size += chunk.length;
    if (size > max) return null; // leaving the loop cancels the stream
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
