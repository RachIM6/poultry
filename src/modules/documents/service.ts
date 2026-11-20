import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { addFarmDays, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can, type Action } from "@/lib/permissions";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { CreateDocument, DOCUMENT_MUTATIONS as M, DOCUMENT_SOON_DAYS, UpdateDocument, checkFile, type DocumentDto, type DocumentFields, type FilePurpose, type FileType } from "@/modules/documents/schema";
import { farmBelongsTo, onssaAuthorizationsDueBy } from "@/modules/farm-registry";
import { notify } from "@/modules/notifications";

// SPEC-m2-compliance DC2, ADR-011, light module: files in PostgreSQL. The route handlers are only HTTP around this.

const WHO: Record<FilePurpose, Action> = { proof: "biosecurity.record", document: "documents.manage", receipt: "finance.record" };
// Reading may be wider than uploading: the accountant partner reads the books and their export (SPEC-m5 PA5), receipts included.
const READERS: Record<FilePurpose, Action> = { ...WHO, receipt: "money.read" };

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
  if (!f || !can(ctx, READERS[f.purpose as FilePurpose])) return fail("NOT_FOUND");
  return ok({ bytes: f.bytes, contentType: f.contentType as FileType, sha256: f.sha256 });
}

// DC1: the vault, offline like every farm record. Owners and managers only, for writes and for pull.

type DocumentRow = { id: string; title: string; category: string; farmId: string | null; issuedOn: Date | null; expiresOn: Date | null; notes: string | null; fileId: string | null };
const date = (d: string | null | undefined) => (d === undefined ? undefined : d === null ? null : new Date(`${d}T00:00:00Z`));
const dayOf = (d: Date | null) => d && d.toISOString().slice(0, 10);
const documentDto = (r: DocumentRow): DocumentDto => ({
  id: r.id,
  title: r.title,
  category: r.category as DocumentDto["category"],
  farmId: r.farmId,
  issuedOn: dayOf(r.issuedOn),
  expiresOn: dayOf(r.expiresOn),
  notes: r.notes,
  fileId: r.fileId,
});
const columns = <F extends Partial<DocumentFields>>(f: F) => ({ ...f, issuedOn: date(f.issuedOn), expiresOn: date(f.expiresOn) });

async function checkFields(tx: Tx, ctx: TenantContext, f: Partial<DocumentFields>): Promise<Result<void>> {
  if (f.farmId && !(await farmBelongsTo(tx, ctx, f.farmId))) return fail("NOT_FOUND");
  return ok(undefined);
}

export const documentsSync: SyncRegistry = {
  mutations: {
    [M.createDocument]: defineMutation({
      schema: CreateDocument,
      action: "documents.manage",
      async apply(tx, ctx, { id, ...fields }, meta) {
        const checked = await checkFields(tx, ctx, fields);
        if (!checked.ok) return checked;
        if (await tx.document.findUnique({ where: { id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const dto = documentDto(await tx.document.create({ data: { id, organizationId: ctx.organizationId, ...columns(fields), createdBy: ctx.userId } }));
        await recordChange(tx, ctx, "document", id, dto);
        await audit(tx, ctx, { entity: "Document", entityId: id, action: "create", after: dto, ...meta });
        return ok(undefined);
      },
    }),
    [M.updateDocument]: defineMutation({
      schema: UpdateDocument,
      action: "documents.manage",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await tx.document.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        const checked = await checkFields(tx, ctx, changes);
        if (!checked.ok) return checked;
        const before = documentDto(row);
        const dto = documentDto(await tx.document.update({ where: { id }, data: columns(changes) }));
        await recordChange(tx, ctx, "document", id, dto);
        await audit(tx, ctx, { entity: "Document", entityId: id, action: "update", before: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof DocumentDto]])), after: changes, ...meta });
        return ok(undefined);
      },
    }),
  },
  // SPEC I5 and DC1: leases, contracts and tax papers never reach a worker's phone.
  entities: { document: (ctx, data: DocumentDto) => (can(ctx, "documents.manage") ? data : undefined) },
};

/** DC2: attaches the scan the upload route has just stored for this organisation, once. */
export async function attachDocumentFile(ctx: TenantContext, documentId: string, fileId: string): Promise<Result<void>> {
  if (!can(ctx, "documents.manage")) return fail("FORBIDDEN");
  return db.$transaction(async (tx) => {
    // Conditional update: of two uploads at once, only the first attaches.
    const { count } = await tx.document.updateMany({ where: { id: documentId, organizationId: ctx.organizationId, fileId: null }, data: { fileId } });
    const row = await tx.document.findFirst({ where: { id: documentId, organizationId: ctx.organizationId } });
    if (!row) return fail("NOT_FOUND");
    if (count === 0) return fail("FILE_ALREADY_ATTACHED");
    const dto = documentDto(row);
    await recordChange(tx, ctx, "document", documentId, dto);
    await audit(tx, ctx, { entity: "Document", entityId: documentId, action: "update", before: { fileId: null }, after: { fileId } });
    return ok(undefined);
  });
}

// DC4: expiry reminders, from the host's scheduler (POST /api/push/dispatch), like the vaccination reminders.

// Not a member: the scheduler acts for each organisation only to notify its members.
const SCHEDULER = "00000000-0000-0000-0000-000000000000";
const dmy = (day: string) => day.split("-").reverse().join("/"); // 30/11/2026: the same in Arabic and French (Western digits)

/**
 * Within DOCUMENT_SOON_DAYS of its expiry a document is announced once ("soon"), and once more from its expiry day
 * ("expired"), to owners and managers. The claim row makes each announcement happen once, even with two schedulers.
 * The farm's ONSSA authorization (SPEC F2) is announced the same way. Returns how many were announced.
 */
export async function sendDocumentReminders(clock: Clock = systemClock): Promise<number> {
  const today = farmDayOf(clock.now());
  const until = addFarmDays(today, DOCUMENT_SOON_DAYS);
  const docs = await db.document.findMany({ where: { expiresOn: { lte: new Date(`${until}T00:00:00Z`) } }, select: { id: true, organizationId: true, title: true, expiresOn: true } });
  const due = [
    ...docs.map((d) => ({ subjectId: d.id, organizationId: d.organizationId, title: d.title, expiresOn: d.expiresOn!.toISOString().slice(0, 10) })),
    ...(await onssaAuthorizationsDueBy(until)),
  ];
  let announced = 0;
  for (const d of due) {
    const kind = d.expiresOn <= today ? "expired" : "soon";
    announced += await db.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        INSERT INTO "DocumentReminder" ("subjectId", "expiresOn", kind, "organizationId", "sentAt")
        VALUES (${d.subjectId}::uuid, ${d.expiresOn}::date, ${kind}, ${d.organizationId}::uuid, ${clock.now()})
        ON CONFLICT DO NOTHING`;
      if (claimed === 0) return 0;
      const ctx: TenantContext = { organizationId: d.organizationId, userId: SCHEDULER, role: "owner" };
      const templateKey = kind === "soon" ? "documentExpiring" : "documentExpired";
      await notify(tx, ctx, { roles: ["owner", "manager"], templateKey, params: { title: d.title, date: dmy(d.expiresOn as FarmDay) }, urgency: "normal" }, clock);
      return 1;
    });
  }
  return announced;
}
