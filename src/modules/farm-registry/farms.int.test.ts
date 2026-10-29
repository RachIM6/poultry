import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmRegistrySync as registry } from "@/modules/farm-registry";
import { FARM_MUTATIONS as M, type FarmFields } from "@/modules/farm-registry/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-10-29T09:00:00+01:00" });
const farm: FarmFields = {
  name: "Ferme El Kheir",
  region: "Casablanca-Settat",
  province: "Settat",
  commune: "Ben Ahmed",
  gps: { lat: 33.0013, lng: -7.6164 },
  onssa: { number: "ONSSA/26/0412", expiresOn: "2027-03-31" },
};
const house = { name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" as const };
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("farms and houses through sync (SPEC F2–F4, X2, X3)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => ([a, b] = await twoTenants()));

  it("a farm and two houses pushed by one phone reach another phone on pull, as entered", async () => {
    const [farmId, h1, h2] = [uuidv7(), uuidv7(), uuidv7()];
    expect(
      await statuses(a, [
        m(M.createFarm, { id: farmId, ...farm }),
        m(M.createHouse, { id: h1, farmId, ...house }),
        m(M.createHouse, { id: h2, farmId, ...house, name: "Bâtiment 2", type: "open" }),
      ]),
    ).toEqual(["applied", "applied", "applied"]);

    const secondPhone = await pull(a, 0, registry);
    expect(secondPhone.changes.map((c) => [c.entity, c.data])).toEqual([
      ["farm", { id: farmId, ...farm }],
      ["house", { id: h1, farmId, ...house }],
      ["house", { id: h2, farmId, ...house, name: "Bâtiment 2", type: "open" }],
    ]);
  });

  it("concurrent edits: the same field ends at the last write received, other fields both survive, the overwritten value is audited", async () => {
    const id = uuidv7();
    await push(a, [m(M.createFarm, { id, ...farm })], registry);
    const cursor = (await pull(a, 0, registry)).version;

    // Two phones edited offline; the manager's phone reaches the server first.
    const fromPhoneA = m(M.updateFarm, { id, changes: { name: "Ferme A", province: "Berrechid" } });
    const fromPhoneB = m(M.updateFarm, { id, changes: { name: "Ferme B", commune: "Sidi Hajjaj" } });
    expect(await statuses(a, [fromPhoneA])).toEqual(["applied"]);
    expect(await statuses(a, [fromPhoneB])).toEqual(["applied"]);

    const latest = (await pull(a, cursor, registry)).changes.at(-1)!.data;
    expect(latest).toMatchObject({ name: "Ferme B", province: "Berrechid", commune: "Sidi Hajjaj", region: farm.region });
    const audited = await db.auditEvent.findFirstOrThrow({ where: { mutationId: fromPhoneB.id } });
    expect(audited).toMatchObject({ entity: "Farm", action: "update", before: { name: "Ferme A", commune: "Ben Ahmed" }, after: { name: "Ferme B", commune: "Sidi Hajjaj" } });
  });

  it("clears GPS and the ONSSA authorization, and keeps the expiry a calendar date", async () => {
    const id = uuidv7();
    await push(a, [m(M.createFarm, { id, ...farm }), m(M.updateFarm, { id, changes: { gps: null } })], registry);
    const row = await db.farm.findUniqueOrThrow({ where: { id } });
    expect([row.latitude, row.longitude, row.onssaExpiresOn?.toISOString()]).toEqual([null, null, "2027-03-31T00:00:00.000Z"]);
    await push(a, [m(M.updateFarm, { id, changes: { onssa: null } })], registry);
    expect(await db.farm.findUniqueOrThrow({ where: { id } })).toMatchObject({ onssaNumber: null, onssaExpiresOn: null });
  });

  it("never lets another organisation read or change a farm, nor add a house to it", async () => {
    const id = uuidv7();
    await push(a, [m(M.createFarm, { id, ...farm })], registry);
    expect(
      await statuses(b, [
        m(M.updateFarm, { id, changes: { name: "pris" } }),
        m(M.createHouse, { id: uuidv7(), farmId: id, ...house }),
        m(M.createFarm, { id, ...farm }), // reusing a's id
      ]),
    ).toEqual(["errors.NOT_FOUND", "errors.NOT_FOUND", "errors.ALREADY_EXISTS"]);
    expect((await pull(b, 0, registry)).changes.filter((c) => c.id === id)).toEqual([]);
    expect((await db.farm.findUniqueOrThrow({ where: { id } })).name).toBe(farm.name);
  });

  it("lets workers see farms but not create or edit them, and validates every field", async () => {
    const worker = { ...a, role: "worker" as const };
    const id = uuidv7();
    expect(await statuses(worker, [m(M.createFarm, { id, ...farm })])).toEqual(["errors.FORBIDDEN"]);
    expect((await pull(worker, 0, registry)).changes.some((c) => c.entity === "farm")).toBe(true);

    await push(a, [m(M.createFarm, { id, ...farm })], registry);
    expect(
      await statuses(a, [
        m(M.createHouse, { id: uuidv7(), farmId: id, ...house, areaM2: 0 }),
        m(M.createHouse, { id: uuidv7(), farmId: id, ...house, capacity: 1.5 }),
        m(M.createFarm, { id: uuidv7(), ...farm, onssa: { number: "X", expiresOn: "31/03/2027" } }),
        m(M.updateFarm, { id, changes: {} }),
        m(M.createFarm, { id, ...farm }), // already created
      ]),
    ).toEqual(["errors.INVALID_INPUT", "errors.INVALID_INPUT", "errors.INVALID_INPUT", "errors.INVALID_INPUT", "errors.ALREADY_EXISTS"]);
  });
});
