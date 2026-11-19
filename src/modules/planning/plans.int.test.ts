import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { PLANNING_MUTATIONS as M } from "@/modules/planning/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-m5 PL1, PL5 (T96): plans are saved, edited while planned and cancelled; the downtime is the owner's, with a
// source. Made-up figures.
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) => (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("planned batches (SPEC-m5 PL1, PL5)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, house] = [uuidv7(), uuidv7()];
  const plan = (over: object = {}) => ({ id: uuidv7(), houseId: house, placeOn: "2026-12-15", chicks: 10_000, strainId: "ross-308", hatchery: "Couvoir X", chickPriceCentimes: "450", saleAge: 35, ...over });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await push(a, [
      m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m("farm-registry.createHouse", { id: house, farmId: farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" }),
    ], registry);
  });

  it("a manager plans, edits and cancels; then the plan can no longer change", async () => {
    const p = plan();
    expect(await statuses({ ...a, role: "manager" }, [m(M.savePlan, p), m(M.savePlan, { ...p, chicks: 12_000, saleAge: null })])).toEqual(["applied", "applied"]);
    expect(await db.plannedBatch.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ chicks: 12_000, saleAge: null, status: "planned", farmId: farm, chickPriceCentimes: 450n });
    expect(await statuses(a, [m(M.cancelPlan, { id: p.id }), m(M.cancelPlan, { id: p.id }), m(M.savePlan, p)])).toEqual(["applied", "errors.ALREADY_DONE", "errors.ALREADY_DONE"]);
    const pulled = (await pull(a, 0, registry)).changes.filter((c) => c.id === p.id).at(-1)?.data;
    expect(pulled).toMatchObject({ status: "cancelled", chickPriceCentimes: "450" });
  });

  it("workers never plan and never see the booked chick price; other organisations see nothing and touch nothing", async () => {
    const p = plan();
    await push(a, [m(M.savePlan, p)], registry);
    expect(await statuses({ ...a, role: "worker" }, [m(M.savePlan, plan())])).toEqual(["errors.FORBIDDEN"]);
    const forWorker = (await pull({ ...a, role: "worker" }, 0, registry)).changes.find((c) => c.id === p.id)?.data as Record<string, unknown>;
    expect(forWorker).toMatchObject({ chicks: 10_000 });
    expect(forWorker).not.toHaveProperty("chickPriceCentimes");
    expect(await statuses(b, [m(M.savePlan, plan()), m(M.savePlan, { ...p, chicks: 1 }), m(M.cancelPlan, { id: p.id })])).toEqual(["errors.NOT_FOUND", "errors.NOT_FOUND", "errors.NOT_FOUND"]);
    expect((await pull(b, 0, registry)).changes.some((c) => c.entity === "plannedBatch")).toBe(false);
  });

  it("the owner enters the farm's minimum downtime with its source; a manager cannot, and a source is required", async () => {
    const rule = { id: uuidv7(), farmId: farm, validFrom: "2026-01-01", minDays: 14, source: "Test E2E" };
    expect(await statuses({ ...a, role: "manager" }, [m(M.saveDowntime, rule)])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, [m(M.saveDowntime, { ...rule, id: uuidv7(), source: "" }), m(M.saveDowntime, rule), m(M.saveDowntime, rule)])).toEqual([
      "errors.INVALID_INPUT",
      "applied",
      "errors.ALREADY_EXISTS",
    ]);
    expect(await statuses(b, [m(M.saveDowntime, { ...rule, id: uuidv7() })])).toEqual(["errors.NOT_FOUND"]);
  });
});
