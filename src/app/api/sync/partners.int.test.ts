import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { exportBooks, treasuryOverview } from "@/modules/finance";
import { twoTenants } from "@/test/tenant";

// SPEC-m5 PA4, PA5, ADR-011 (T91): a partner's phone receives only the entities on their role's list. Every synced
// entity must be on the list or below as hidden: adding an entity without deciding for partners fails this test.
const HIDDEN = {
  vet: ["treasuryAccount", "expense", "transfer", "batchCost", "supplier", "purchase", "buyer", "sale", "buyerPayment", "instrumentStatus", "employee", "routine", "oneOffTask", "taskDone", "taskAssignment", "attendance", "advance", "payMonth", "labourRules", "staffRecord", "climateTargets", "climateReading", "powerCut", "price", "plannedBatch", "downtimeRule"],
  accountant: ["dailyEntry", "weighing", "vaccination", "treatment", "vetVisit", "protocol", "routine", "oneOffTask", "taskDone", "taskAssignment", "attendance", "staffRecord", "climateTargets", "climateReading", "powerCut", "plannedBatch", "downtimeRule"],
} as const;

describe("what a partner's phone pulls (SPEC-m5 PA4, PA5)", () => {
  let a: TenantContext;
  const entities = Object.keys(registry.entities);
  beforeAll(async () => {
    [a] = await twoTenants();
    // One change of every synced entity, readable by the caller when a serializer checks the user.
    await db.change.createMany({
      data: entities.map((entity, i) => ({ organizationId: a.organizationId, version: BigInt(1_000 + i), entity, entityId: uuidv7(), data: { id: uuidv7(), userId: a.userId, templateKey: "vaccinationDue" } })),
    });
  });

  for (const role of ["vet", "accountant"] as const) {
    it(`every synced entity is either on the ${role}'s list or hidden from them`, () => {
      const view = registry.views?.[role] ?? [];
      expect(view.filter((e) => (HIDDEN[role] as readonly string[]).includes(e))).toEqual([]);
      expect([...view, ...HIDDEN[role]].sort()).toEqual([...entities].sort());
    });

    it(`a ${role} pulls only their list`, async () => {
      const got = new Set((await pull({ ...a, role }, 0, registry)).changes.map((c) => c.entity));
      for (const hidden of HIDDEN[role]) expect(got.has(hidden), hidden).toBe(false);
      for (const shown of registry.views?.[role] ?? []) expect(got.has(shown), shown).toBe(true);
    });
  }

  it("the accountant opens the books and the export, the vet does not; the accountant's writes are refused", async () => {
    const month = new Date().toISOString().slice(0, 7);
    expect(await exportBooks({ ...a, role: "accountant" }, month)).not.toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await treasuryOverview({ ...a, role: "accountant" }, month)).toMatchObject({ ok: true });
    expect(await exportBooks({ ...a, role: "vet" }, month)).toEqual({ ok: false, error: "FORBIDDEN" });
    const write = { id: uuidv7(), type: "finance.createTreasuryAccount", payload: {}, createdAt: new Date().toISOString() };
    expect((await push({ ...a, role: "accountant" }, [write], registry)).results).toMatchObject([{ status: "rejected", messageKey: "errors.FORBIDDEN" }]);
  });

  it("staff keep their own rules: an owner pulls every entity", async () => {
    const got = new Set((await pull(a, 0, registry)).changes.map((c) => c.entity));
    expect([...got].sort()).toEqual([...entities].sort());
  });
});
