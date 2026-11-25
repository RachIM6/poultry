import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { attachDocumentFile, storeFile } from "@/modules/documents";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T10:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const pdf = new TextEncoder().encode("%PDF-1.7\n…");

describe("document vault through sync (SPEC-m2-compliance DC1, DC2, CX2)", () => {
  let a: TenantContext, b: TenantContext;
  const worker = () => ({ ...a, role: "worker" as const });
  const farmId = uuidv7();
  const doc = (over: object = {}) => ({ id: uuidv7(), title: "Assurance multirisque élevage", category: "insurance", farmId, issuedOn: "2025-12-01", expiresOn: "2026-11-30", notes: null, ...over });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    expect(await statuses(a, m("farm-registry.createFarm", { id: farmId, name: "El Kheir", region: "R", province: "P", commune: "C", gps: null, onssa: null }))).toEqual(["applied"]);
  });

  it("an owner or manager keeps documents; edits are field by field and audited", async () => {
    const d = doc();
    const manager = { ...a, role: "manager" as const };
    expect(await statuses(manager, m("documents.createDocument", d), m("documents.updateDocument", { id: d.id, changes: { expiresOn: "2027-11-30" } }))).toEqual(["applied", "applied"]);
    const pulled = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "document").at(-1);
    expect(pulled?.data).toEqual({ ...d, expiresOn: "2027-11-30", fileId: null });
    expect(await db.auditEvent.findFirst({ where: { entityId: d.id, action: "update" } })).toMatchObject({ before: { expiresOn: "2026-11-30" }, after: { expiresOn: "2027-11-30" } });
  });

  it("a worker can neither write nor receive a document", async () => {
    expect(await statuses(worker(), m("documents.createDocument", doc()))).toEqual(["errors.FORBIDDEN"]);
    expect((await pull(worker(), 0, registry)).changes.filter((c) => c.entity === "document")).toEqual([]);
    expect(await attachDocumentFile(worker(), uuidv7(), uuidv7())).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("the scan is attached once, by its organisation only", async () => {
    const d = doc({ farmId: null });
    await statuses(a, m("documents.createDocument", d));
    const file = await storeFile(a, "document", pdf);
    if (!file.ok) throw new Error(file.error);
    expect(await attachDocumentFile(b, d.id, file.value.id)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await attachDocumentFile(a, d.id, file.value.id)).toEqual({ ok: true, value: undefined });
    expect(await attachDocumentFile(a, d.id, file.value.id)).toEqual({ ok: false, error: "FILE_ALREADY_ATTACHED" });
  });

  it("keeps organisations apart", async () => {
    expect(await statuses(b, m("documents.createDocument", doc()))).toEqual(["errors.NOT_FOUND"]); // a's farm
    const d = doc({ farmId: null });
    await statuses(a, m("documents.createDocument", d));
    expect(await statuses(b, m("documents.updateDocument", { id: d.id, changes: { title: "x" } }))).toEqual(["errors.NOT_FOUND"]);
    expect((await pull(b, 0, registry)).changes.filter((c) => c.entity === "document")).toEqual([]);
  });
});
