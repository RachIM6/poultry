import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { getReferenceData, referenceDataSync as registry } from "@/modules/reference-data";
import { REFERENCE_MUTATIONS as M } from "@/modules/reference-data/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-04T09:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const gumboroDay14 = { dayOfAge: 14, productId: "vaccine-gumboro", method: "drinkingWater" };

describe("protocols (SPEC R2) and reference data (R4)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => {
    [a, b] = await twoTenants();
    // A minimal catalogue (the per-file reset empties the seeded one). Test values, not a real protocol.
    await db.product.createMany({
      data: [
        { id: "vaccine-gumboro", kind: "vaccine", nameFr: "Vaccin Gumboro", nameAr: "لقاح الجمبورو" },
        { id: "feed-starter", kind: "feed", nameFr: "Aliment démarrage", nameAr: "علف البداية" },
      ],
    });
    await db.protocolTemplate.create({ data: { id: "broiler-default", nameFr: "Modèle", nameAr: "نموذج", items: [gumboroDay14] } });
  });

  it("copies the template for the organisation and lets it edit its copy; the template never changes", async () => {
    const id = uuidv7();
    expect(await statuses(a, [m(M.copyProtocol, { id, templateId: "broiler-default", name: "Mon programme" })])).toEqual(["applied"]);
    const extra = { dayOfAge: 21, productId: "vaccine-gumboro", method: "spray" };
    expect(await statuses(a, [m(M.updateProtocol, { id, changes: { items: [gumboroDay14, extra] } })])).toEqual(["applied"]);

    const pulled = (await pull(a, 0, registry)).changes.map((c) => c.data);
    expect(pulled.at(-1)).toEqual({ id, templateId: "broiler-default", name: "Mon programme", items: [gumboroDay14, extra] });
    expect((await db.protocolTemplate.findUniqueOrThrow({ where: { id: "broiler-default" } })).items).toEqual([gumboroDay14]);
    const audited = await db.auditEvent.findFirstOrThrow({ where: { entity: "VaccinationProtocol", action: "update" } });
    expect(audited).toMatchObject({ before: { items: [gumboroDay14] }, after: { items: [gumboroDay14, extra] } });
  });

  it("accepts only catalogue vaccines in a schedule", async () => {
    const id = uuidv7();
    await push(a, [m(M.copyProtocol, { id, templateId: "broiler-default", name: "P" })], registry);
    expect(
      await statuses(a, [
        m(M.updateProtocol, { id, changes: { items: [{ ...gumboroDay14, productId: "feed-starter" }] } }), // a feed
        m(M.updateProtocol, { id, changes: { items: [{ ...gumboroDay14, productId: "vaccine-unknown" }] } }),
        m(M.updateProtocol, { id, changes: { items: [{ ...gumboroDay14, dayOfAge: -1 }] } }),
        m(M.copyProtocol, { id: uuidv7(), templateId: "no-such-template", name: "P" }),
      ]),
    ).toEqual(["errors.INVALID_INPUT", "errors.INVALID_INPUT", "errors.INVALID_INPUT", "errors.NOT_FOUND"]);
  });

  it("keeps each organisation's protocols to itself, and lets workers read but not write them", async () => {
    const id = uuidv7();
    await push(a, [m(M.copyProtocol, { id, templateId: "broiler-default", name: "A" })], registry);
    expect(await statuses(b, [m(M.updateProtocol, { id, changes: { name: "pris" } })])).toEqual(["errors.NOT_FOUND"]);
    expect((await pull(b, 0, registry)).changes.filter((c) => c.id === id)).toEqual([]);

    const worker = { ...a, role: "worker" as const };
    expect(await statuses(worker, [m(M.copyProtocol, { id: uuidv7(), templateId: "broiler-default", name: "W" })])).toEqual(["errors.FORBIDDEN"]);
    expect((await pull(worker, 0, registry)).changes.some((c) => c.id === id)).toBe(true);
  });

  it("serves the whole catalogue for the phone to keep offline", async () => {
    const reference = await getReferenceData();
    expect(reference.products.map((p) => p.id)).toEqual(["feed-starter", "vaccine-gumboro"]);
    expect(reference.protocolTemplates).toEqual([
      { id: "broiler-default", nameFr: "Modèle", nameAr: "نموذج", reviewedByVet: false, items: [gumboroDay14] },
    ]);
  });
});
