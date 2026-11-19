import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can, type Action } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { checkFile, type FilePurpose, type FileType } from "@/modules/documents/shared";

// SPEC-m2-compliance DC2, ADR-011, light module: files in PostgreSQL. The route handlers are only HTTP around this.

const WHO: Record<FilePurpose, Action> = { proof: "biosecurity.record", document: "documents.manage" };

export async function storeFile(ctx: TenantContext, purpose: FilePurpose, bytes: Uint8Array): Promise<Result<{ id: string }, "FORBIDDEN" | "FILE_TOO_LARGE" | "FILE_TYPE_NOT_ALLOWED">> {
  if (!can(ctx, WHO[purpose])) return fail("FORBIDDEN");
  const type = checkFile(bytes);
  if (!type.ok) return type;
  const id = uuidv7(); // an online upload, not a record created offline: the server names it
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await db.$transaction(async (tx) => {
    await tx.storedFile.create({
      data: { id, organizationId: ctx.organizationId, purpose, contentType: type.value, sizeBytes: bytes.length, sha256, bytes: Buffer.from(bytes), uploadedBy: ctx.userId },
    });
    await audit(tx, ctx, { entity: "StoredFile", entityId: id, action: "create", after: { purpose, contentType: type.value, sizeBytes: bytes.length, sha256 } });
  });
  return ok({ id });
}

/** The caller's organisation's file, if their role may see it. Anything else is NOT_FOUND: never say it exists. */
export async function readFile(ctx: TenantContext, id: string): Promise<Result<{ bytes: Uint8Array; contentType: FileType; sha256: string }, "NOT_FOUND">> {
  const f = await db.storedFile.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!f || !can(ctx, WHO[f.purpose as FilePurpose])) return fail("NOT_FOUND");
  return ok({ bytes: f.bytes, contentType: f.contentType as FileType, sha256: f.sha256 });
}
