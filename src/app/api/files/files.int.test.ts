import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "./route";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { attachRodentProof } from "@/modules/biosecurity";
import { readFile, storeFile } from "@/modules/documents";
import { MAX_FILE_BYTES } from "@/modules/documents/shared";
import { twoTenants } from "@/test/tenant";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pdf = new TextEncoder().encode("%PDF-1.7\n…");
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T10:00:00+01:00" });

describe("stored files and rodent proof (SPEC-m2-compliance DC2, BS8, ADR-011, CX2)", () => {
  let a: TenantContext, b: TenantContext;
  const worker = () => ({ ...a, role: "worker" as const });
  const farmId = uuidv7();

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await push(a, [m("farm-registry.createFarm", { id: farmId, name: "El Kheir", region: "R", province: "P", commune: "C", gps: null, onssa: null })], registry);
  });

  it("keeps a file with the type read from its bytes, its size and hash, audited", async () => {
    const stored = await storeFile(a, "document", pdf);
    if (!stored.ok) throw new Error(stored.error);
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: stored.value.id } });
    expect(row).toMatchObject({ organizationId: a.organizationId, purpose: "document", contentType: "application/pdf", sizeBytes: pdf.length });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await db.auditEvent.count({ where: { entityId: row.id, action: "create" } })).toBe(1);
    const read = await readFile(a, row.id);
    expect(read.ok && Buffer.from(read.value.bytes).equals(Buffer.from(pdf))).toBe(true);
  });

  it("refuses a wrong type or an oversized file", async () => {
    expect(await storeFile(a, "document", new TextEncoder().encode("<html>"))).toEqual({ ok: false, error: "FILE_TYPE_NOT_ALLOWED" });
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(png);
    expect(await storeFile(a, "proof", big)).toEqual({ ok: false, error: "FILE_TOO_LARGE" });
  });

  it("a worker uploads and reads proofs, never vault documents; another organisation reads nothing", async () => {
    expect(await storeFile(worker(), "document", pdf)).toEqual({ ok: false, error: "FORBIDDEN" });
    const proof = await storeFile(worker(), "proof", png);
    const doc = await storeFile(a, "document", pdf);
    if (!proof.ok || !doc.ok) throw new Error("setup");
    expect((await readFile(worker(), proof.value.id)).ok).toBe(true);
    expect(await readFile(worker(), doc.value.id)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await readFile(b, proof.value.id)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await readFile(b, doc.value.id)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("a rodent check is recorded offline, then gets its proof once; another organisation can't attach to it", async () => {
    const check = { id: uuidv7(), farmId, houseId: null, day: "2026-11-05", action: "baitPlaced", product: "Brodifacoum" };
    expect((await push(worker(), [m("biosecurity.recordRodentCheck", check)], registry)).results.map((r) => r.status)).toEqual(["applied"]);
    const proof = await storeFile(worker(), "proof", png);
    if (!proof.ok) throw new Error(proof.error);
    expect(await attachRodentProof(b, check.id, proof.value.id)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await attachRodentProof(worker(), check.id, proof.value.id)).toEqual({ ok: true, value: undefined });
    expect(await attachRodentProof(worker(), check.id, proof.value.id)).toEqual({ ok: false, error: "PROOF_ALREADY_ATTACHED" });
    const pulled = (await pull(worker(), 0, registry)).changes.filter((c) => c.entity === "rodentCheck").at(-1);
    expect(pulled?.data).toEqual({ ...check, proofFileId: proof.value.id });
    expect((await pull(b, 0, registry)).changes.filter((c) => c.entity === "rodentCheck")).toEqual([]);
  });

  it("the upload route refuses a cross-site request before anything else (poultry-auth §4)", async () => {
    const res = await POST(new Request("http://localhost:3000/api/files?purpose=document", { method: "POST", body: pdf, headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });
});
