import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmRegistrySync as registry } from "@/modules/farm-registry";
import { FARM_MUTATIONS as M, type FarmDto, type FarmFields } from "@/modules/farm-registry/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-23T09:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const pulledFarm = async (ctx: TenantContext, id: string) => (await pull(ctx, 0, registry)).changes.findLast((c) => c.id === id)?.data as FarmDto | undefined;
const keepersOf = (farmId: string) =>
  db.registerKeeper.findMany({ where: { farmId }, orderBy: { n: "asc" }, select: { n: true, name: true, position: true, fromOn: true, toOn: true } });

const farm: FarmFields = { name: "Ferme El Kheir", region: "Casablanca-Settat", province: "Settat", commune: "Ben Ahmed", gps: null, onssa: null };
// Made-up people: the fields are the arrêté's (2126-05, art. 3 and 4), the values only test the mechanics.
const register = {
  holder: { name: "Ahmed Bennani", address: "12 rue des Oliviers, Settat" },
  vet: { name: "Dr Alaoui", address: "Cabinet vétérinaire, Berrechid", phone: "0612345678" },
  technicianName: "Youssef Amrani",
  chickImportApproval: "AGR-IMP-0042",
  registerKeepers: [
    { name: "Ahmed Bennani", position: "Exploitant", from: "2026-01-01", to: "2026-06-30" },
    { name: "Karim Idrissi", position: "Chef d’élevage", from: "2026-07-01", to: null },
  ],
};

describe("the register's cover on the farm (arrêté 2126-05 art. 3–4, SPEC-m2 RP1)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => ([a, b] = await twoTenants()));

  it("an owner sets them with the farm; another phone pulls them as entered; keepers are rows in order", async () => {
    const id = uuidv7();
    expect(await statuses(a, [m(M.createFarm, { id, ...farm, ...register })])).toEqual(["applied"]);
    expect(await pulledFarm(a, id)).toEqual({ id, ...farm, doaClaimThresholdPermille: null, ...register });
    expect(await db.farm.findUniqueOrThrow({ where: { id } })).toMatchObject({ holderName: "Ahmed Bennani", vetPhone: "0612345678", chickImportApproval: "AGR-IMP-0042" });
    expect(await keepersOf(id)).toEqual([
      { n: 0, name: "Ahmed Bennani", position: "Exploitant", fromOn: new Date("2026-01-01T00:00:00Z"), toOn: new Date("2026-06-30T00:00:00Z") },
      { n: 1, name: "Karim Idrissi", position: "Chef d’élevage", fromOn: new Date("2026-07-01T00:00:00Z"), toOn: null },
    ]);
  });

  it("a manager edits them: the keepers list is replaced whole, other fields stay, the edit is audited", async () => {
    const id = uuidv7();
    await push(a, [m(M.createFarm, { id, ...farm, ...register })], registry);
    const manager = { ...a, role: "manager" as const };
    const keepers = [{ name: "Karim Idrissi", position: "Chef d’élevage", from: "2026-07-01", to: "2026-11-20" }];
    const edit = m(M.updateFarm, { id, changes: { vet: { name: "Dr Tazi", address: null, phone: null }, registerKeepers: keepers } });
    expect(await statuses(manager, [edit])).toEqual(["applied"]);

    expect(await pulledFarm(a, id)).toMatchObject({ holder: register.holder, technicianName: "Youssef Amrani", vet: { name: "Dr Tazi", address: null, phone: null }, registerKeepers: keepers });
    expect((await keepersOf(id)).map((k) => k.name)).toEqual(["Karim Idrissi"]);
    const audited = await db.auditEvent.findFirstOrThrow({ where: { mutationId: edit.id } });
    expect(audited).toMatchObject({ entity: "Farm", entityId: id, action: "update", before: { vet: register.vet, registerKeepers: register.registerKeepers }, after: { registerKeepers: keepers } });

    // Cleared: back to none
    const clear = { holder: null, vet: null, technicianName: null, chickImportApproval: null, registerKeepers: [] };
    expect(await statuses(a, [m(M.updateFarm, { id, changes: clear })])).toEqual(["applied"]);
    expect(await pulledFarm(a, id)).toMatchObject(clear);
    expect(await keepersOf(id)).toEqual([]);
  });

  it("offline replay: the same mutation pushed twice is applied once (one audit, no keeper twice)", async () => {
    const id = uuidv7();
    await push(a, [m(M.createFarm, { id, ...farm })], registry);
    const edit = m(M.updateFarm, { id, changes: { registerKeepers: register.registerKeepers } });
    expect(await statuses(a, [edit])).toEqual(["applied"]);
    expect(await statuses(a, [edit])).toEqual(["applied"]); // the stored result, nothing applied again
    expect(await keepersOf(id)).toHaveLength(2);
    expect(await db.auditEvent.count({ where: { mutationId: edit.id } })).toBe(1);
  });

  it("workers can't set them; another organisation can't read or change them", async () => {
    const id = uuidv7();
    await push(a, [m(M.createFarm, { id, ...farm, ...register })], registry);
    expect(await statuses({ ...a, role: "worker" }, [m(M.updateFarm, { id, changes: { technicianName: "X" } })])).toEqual(["FORBIDDEN"]);
    expect(await statuses(b, [m(M.updateFarm, { id, changes: { registerKeepers: [] } })])).toEqual(["NOT_FOUND"]);
    expect(await keepersOf(id)).toHaveLength(2);
    expect((await db.farm.findUniqueOrThrow({ where: { id } })).technicianName).toBe("Youssef Amrani");
    expect(await pulledFarm(b, id)).toBeUndefined();
  });

  it("validates them: a name for the holder, the vet and each keeper; a keeper can't end before starting", async () => {
    const id = uuidv7();
    await push(a, [m(M.createFarm, { id, ...farm })], registry);
    const keeper = register.registerKeepers[0];
    expect(
      await statuses(a, [
        m(M.updateFarm, { id, changes: { holder: { name: "", address: "Settat" } } }),
        m(M.updateFarm, { id, changes: { vet: { name: "Dr X" } } }), // address and phone: null, not absent
        m(M.updateFarm, { id, changes: { registerKeepers: [{ ...keeper, position: "" }] } }),
        m(M.updateFarm, { id, changes: { registerKeepers: [{ ...keeper, from: "2026-07-01", to: "2026-06-30" }] } }),
        m(M.updateFarm, { id, changes: { registerKeepers: [{ ...keeper, from: "01/07/2026" }] } }),
      ]),
    ).toEqual(Array(5).fill("INVALID_INPUT"));
    expect(await keepersOf(id)).toEqual([]);
  });
});
