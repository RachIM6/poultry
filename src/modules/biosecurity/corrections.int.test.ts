import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-06T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const last = async (ctx: TenantContext, entity: string, id: string) =>
  (await pull(ctx, 0, registry)).changes.filter((c) => c.entity === entity && c.id === id).at(-1)?.data;
const updates = (entityId: string) => db.auditEvent.findMany({ where: { entityId, action: "update" }, select: { before: true, after: true } });

describe("corrections of biosecurity records (SPEC-m2-compliance D6, BS9, CX2)", () => {
  let a: TenantContext, b: TenantContext;
  const worker = () => ({ ...a, role: "worker" as const });
  const vet = () => ({ ...a, role: "vet" as const }); // may not record biosecurity, so may not correct it
  const [farmId, houseId, otherHouse, batchId, closed] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const place = (id: string, house: string, placedOn: string) =>
    m("flock.placeBatch", { id, houseId: house, strainId: "ross-308", placedOn, chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    const house = { areaM2: 1000, capacity: 10000, type: "closed" };
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: farmId, name: "El Kheir", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: houseId, farmId, name: "Bâtiment 1", ...house }),
        m("farm-registry.createHouse", { id: otherHouse, farmId, name: "Bâtiment 2", ...house }),
        place(batchId, houseId, "2026-10-05"),
        place(closed, otherHouse, "2026-09-01"),
        m("flock.closeBatch", { batchId: closed, day: "2026-11-01", reason: "Fin de lot" }),
      ),
    ).toEqual(Array(6).fill("applied"));
  });

  it("a visit: a worker corrects it once, even pushed twice; audited before/after, pulled corrected; the zone rule still holds", async () => {
    const v = { id: uuidv7(), farmId, enteredAt: "2026-11-06T08:00:00.000Z", visitor: "Livreur", vehicle: null, purpose: "gas", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: false, zone: "clean" };
    expect(await statuses(worker(), m("biosecurity.recordVisit", v))).toEqual(["applied"]);
    const fix = m("biosecurity.editVisit", { id: v.id, changes: { visitor: "Livreur · Gaz Atlas", vehicle: "12345-A-6" } });
    expect(await statuses(worker(), fix, fix)).toEqual(["applied", "applied"]);
    expect(await updates(v.id)).toEqual([{ before: { visitor: "Livreur", vehicle: null }, after: { visitor: "Livreur · Gaz Atlas", vehicle: "12345-A-6" } }]);
    expect(await last(a, "visit", v.id)).toEqual({ ...v, visitor: "Livreur · Gaz Atlas", vehicle: "12345-A-6" });
    // From another poultry farm and in the clean zone: refused, as when recording it.
    expect(await statuses(worker(), m("biosecurity.editVisit", { id: v.id, changes: { recentFarm: true } }))).toEqual(["errors.VISIT_DIRTY_ZONE_ONLY"]);
    expect(await statuses(worker(), m("biosecurity.editVisit", { id: v.id, changes: { recentFarm: true, zone: "dirty" } }))).toEqual(["applied"]);
    expect(await statuses(vet(), m("biosecurity.editVisit", { id: v.id, changes: { visitor: "X" } }))).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(b, m("biosecurity.editVisit", { id: v.id, changes: { visitor: "X" } }))).toEqual(["errors.NOT_FOUND"]);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).visitor).toBe("Livreur · Gaz Atlas");
  });

  it("a disposal: corrected and audited; 'other' still needs a description; the batch must be the farm's", async () => {
    const d = { id: uuidv7(), farmId, day: "2026-11-05", batchId, birds: 6, weightGrams: 9800, method: "incineration", methodNote: null };
    expect(await statuses(worker(), m("biosecurity.recordDisposal", d))).toEqual(["applied"]);
    const fix = m("biosecurity.editDisposal", { id: d.id, changes: { birds: 7, day: "2026-11-04" } });
    expect(await statuses(worker(), fix, fix)).toEqual(["applied", "applied"]);
    expect(await updates(d.id)).toEqual([{ before: { birds: 6, day: "2026-11-05" }, after: { birds: 7, day: "2026-11-04" } }]);
    expect(await last(a, "disposal", d.id)).toEqual({ ...d, birds: 7, day: "2026-11-04" });
    expect(await statuses(worker(), m("biosecurity.editDisposal", { id: d.id, changes: { method: "other" } }))).toEqual(["errors.DISPOSAL_METHOD_NOTE_REQUIRED"]);
    expect(await statuses(worker(), m("biosecurity.editDisposal", { id: d.id, changes: { batchId: uuidv7() } }))).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(vet(), m("biosecurity.editDisposal", { id: d.id, changes: { birds: 1 } }))).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(b, m("biosecurity.editDisposal", { id: d.id, changes: { birds: 1 } }))).toEqual(["errors.NOT_FOUND"]);
    expect((await db.disposal.findUniqueOrThrow({ where: { id: d.id } })).birds).toBe(7);
  });

  it("a manure removal: corrected and audited; the batch must stay in the house given", async () => {
    const r = { id: uuidv7(), farmId, day: "2026-11-03", houseId, batchId, quantityKg: 18000, destination: "stored", recipient: null };
    expect(await statuses(worker(), m("biosecurity.recordManure", r))).toEqual(["applied"]);
    const fix = m("biosecurity.editManure", { id: r.id, changes: { quantityKg: 17500, destination: "sold", recipient: "Ferme Ouled Said" } });
    expect(await statuses(worker(), fix, fix)).toEqual(["applied", "applied"]);
    expect(await updates(r.id)).toEqual([{ before: { quantityKg: 18000, destination: "stored", recipient: null }, after: { quantityKg: 17500, destination: "sold", recipient: "Ferme Ouled Said" } }]);
    expect(await last(a, "manureRemoval", r.id)).toEqual({ ...r, quantityKg: 17500, destination: "sold", recipient: "Ferme Ouled Said" });
    expect(await statuses(worker(), m("biosecurity.editManure", { id: r.id, changes: { houseId: otherHouse } }))).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(vet(), m("biosecurity.editManure", { id: r.id, changes: { quantityKg: 1 } }))).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(b, m("biosecurity.editManure", { id: r.id, changes: { quantityKg: 1 } }))).toEqual(["errors.NOT_FOUND"]);
  });

  it("a rodent check: corrected and audited, its proof kept", async () => {
    const r = { id: uuidv7(), farmId, houseId, day: "2026-11-02", action: "baitPlaced", product: null };
    expect(await statuses(worker(), m("biosecurity.recordRodentCheck", r))).toEqual(["applied"]);
    const fix = m("biosecurity.editRodentCheck", { id: r.id, changes: { action: "baitChecked", product: "Brodifacoum" } });
    expect(await statuses(worker(), fix, fix)).toEqual(["applied", "applied"]);
    expect(await updates(r.id)).toEqual([{ before: { action: "baitPlaced", product: null }, after: { action: "baitChecked", product: "Brodifacoum" } }]);
    expect(await last(a, "rodentCheck", r.id)).toEqual({ ...r, action: "baitChecked", product: "Brodifacoum", proofFileId: null });
    expect(await statuses(worker(), m("biosecurity.editRodentCheck", { id: r.id, changes: { proofFileId: uuidv7() } }))).toEqual(["errors.INVALID_INPUT"]); // the proof is not a correction
    expect(await statuses(vet(), m("biosecurity.editRodentCheck", { id: r.id, changes: { product: "X" } }))).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(b, m("biosecurity.editRodentCheck", { id: r.id, changes: { product: "X" } }))).toEqual(["errors.NOT_FOUND"]);
  });

  it("a clean-out step: corrected and audited, the clean-out pulled with it; disinfection keeps its product", async () => {
    const cleanoutId = uuidv7();
    const step = { id: uuidv7(), step: "disinfection", day: "2026-11-04", product: "Virkon S", dose: "1 %", productLot: null, note: null };
    expect(await statuses(worker(), m("biosecurity.startCleanout", { id: cleanoutId, houseId: otherHouse, afterBatchId: closed, startedOn: "2026-11-02" }), m("biosecurity.recordCleanoutStep", { ...step, cleanoutId }))).toEqual(["applied", "applied"]);
    const fix = m("biosecurity.editCleanoutStep", { id: step.id, changes: { day: "2026-11-03", productLot: "L2611" } });
    expect(await statuses(worker(), fix, fix)).toEqual(["applied", "applied"]);
    expect(await updates(step.id)).toEqual([{ before: { day: "2026-11-04", productLot: null }, after: { day: "2026-11-03", productLot: "L2611" } }]);
    expect(await last(a, "cleanout", cleanoutId)).toMatchObject({ steps: [{ ...step, day: "2026-11-03", productLot: "L2611" }] });
    expect(await statuses(worker(), m("biosecurity.editCleanoutStep", { id: step.id, changes: { product: null } }))).toEqual(["errors.DISINFECTANT_REQUIRED"]);
    expect(await statuses(vet(), m("biosecurity.editCleanoutStep", { id: step.id, changes: { note: "X" } }))).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(b, m("biosecurity.editCleanoutStep", { id: step.id, changes: { note: "X" } }))).toEqual(["errors.NOT_FOUND"]);
  });

  it("an empty correction is refused", async () => {
    expect(await statuses(a, m("biosecurity.editVisit", { id: uuidv7(), changes: {} }))).toEqual(["errors.INVALID_INPUT"]);
  });
});
