import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T09:05:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const farm = { name: "Ferme El Kheir", region: "Casablanca-Settat", province: "Settat", commune: "Ouled Said", gps: null, onssa: null };

describe("visitor log through sync (SPEC-m2-compliance BS1, BS2, BS9, CX2)", () => {
  let a: TenantContext, b: TenantContext;
  const farmId = uuidv7();
  const visit = (over: object = {}) => ({
    id: uuidv7(),
    farmId,
    enteredAt: "2026-11-05T09:05:00+01:00",
    visitor: "Livreur · Provende Atlas",
    vehicle: "12345-A-6",
    purpose: "feedDelivery",
    recentFarm: true,
    wheelsDisinfected: true,
    footbath: true,
    farmClothing: false,
    zone: "dirty",
    ...over,
  });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    expect(await statuses(a, m("farm-registry.createFarm", { id: farmId, ...farm }))).toEqual(["applied"]);
  });

  it("a worker records a visit once, even when the phone pushes it twice; it is audited and pulled as entered", async () => {
    const worker = { ...a, role: "worker" as const };
    const v = visit();
    const mutation = m("biosecurity.recordVisit", v);
    expect(await statuses(worker, mutation, mutation)).toEqual(["applied", "applied"]);
    expect(await statuses(worker, m("biosecurity.recordVisit", v))).toEqual(["errors.ALREADY_EXISTS"]);
    expect(await db.visit.count({ where: { id: v.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: v.id, action: "create" } })).toBe(1);
    const pulled = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "visit");
    expect(pulled.map((c) => c.data)).toEqual([v]);
  });

  it("refuses the clean zone to a visitor from another poultry farm, on the server too", async () => {
    expect(await statuses(a, m("biosecurity.recordVisit", visit({ zone: "clean" })))).toEqual(["errors.VISIT_DIRTY_ZONE_ONLY"]);
    expect(await statuses(a, m("biosecurity.recordVisit", visit({ zone: "clean", recentFarm: false })))).toEqual(["applied"]);
  });

  it("keeps organisations apart: another organisation can't write to the farm or read its visits", async () => {
    expect(await statuses(b, m("biosecurity.recordVisit", visit()))).toEqual(["errors.NOT_FOUND"]);
    expect((await pull(b, 0, registry)).changes.filter((c) => c.entity === "visit")).toEqual([]);
  });
});
