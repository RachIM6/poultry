import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { farmDayOf, nextFarmDay } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { farmRegistrySync } from "@/modules/farm-registry";
import { FARM_MUTATIONS } from "@/modules/farm-registry/schema";
import { flockSync as registry } from "@/modules/flock";
import { FLOCK_MUTATIONS as M, type BatchDto } from "@/modules/flock/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-06T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const placement = (houseId: string, over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  houseId,
  strainId: "ross-308",
  placedOn: "2026-10-14",
  chicksPlaced: 12_000,
  deadOnArrival: 36,
  hatchery: "Couvoir Atlas",
  deliveryNote: "BL-0412",
  chickUnitPriceCentimes: "450",
  dayOldWeightGrams: 42,
  ...over,
});

describe("batch placement (SPEC B1)", () => {
  let a: TenantContext, b: TenantContext;
  const [farmA, farmB] = [uuidv7(), uuidv7()];
  const houses = { a1: uuidv7(), a2: uuidv7(), a3: uuidv7(), b1: uuidv7() };

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } }); // an M1 row: broiler by default
    await db.strain.create({ data: { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] } });
    const farm = (id: string) => m(FARM_MUTATIONS.createFarm, { id, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null });
    const house = (id: string, farmId: string) => m(FARM_MUTATIONS.createHouse, { id, farmId, name: "B", areaM2: 1200, capacity: 12000, type: "closed" });
    await push(a, [farm(farmA), house(houses.a1, farmA), house(houses.a2, farmA), house(houses.a3, farmA)], farmRegistrySync);
    await push(b, [farm(farmB), house(houses.b1, farmB)], farmRegistrySync);
  });

  it("places a batch, then refuses a second open one in the same house", async () => {
    const first = placement(houses.a1);
    expect(await statuses(a, [m(M.placeBatch, first)])).toEqual(["applied"]);
    expect(await statuses(a, [m(M.placeBatch, placement(houses.a1))])).toEqual(["errors.HOUSE_HAS_OPEN_BATCH"]);
    expect(await statuses(a, [m(M.placeBatch, placement(houses.a2))])).toEqual(["applied"]); // another house is fine

    const pulled = (await pull(a, 0, registry)).changes.map((c) => c.data as BatchDto).find((d) => d.id === first.id);
    expect(pulled).toMatchObject({ farmId: farmA, houseId: houses.a1, status: "open", chickUnitPriceCentimes: "450", placedOn: "2026-10-14" });
  });

  it("keeps one open batch when two phones place one in the same house at the same moment", async () => {
    const [one, two] = await Promise.all([statuses(a, [m(M.placeBatch, placement(houses.a3))]), statuses(a, [m(M.placeBatch, placement(houses.a3))])]);
    expect([...one, ...two].sort()).toEqual(["applied", "errors.HOUSE_HAS_OPEN_BATCH"]);
    expect(await db.batch.count({ where: { houseId: houses.a3, status: "open" } })).toBe(1);
  });

  it("checks the house, the strain and the date, and keeps money from workers", async () => {
    const tooLate = nextFarmDay(nextFarmDay(nextFarmDay(farmDayOf(new Date()))));
    expect(
      await statuses(b, [
        m(M.placeBatch, placement(houses.a2)), // a's house
        m(M.placeBatch, placement(houses.b1, { strainId: "no-such-strain" })),
        m(M.placeBatch, placement(houses.b1, { placedOn: tooLate })),
        m(M.placeBatch, placement(houses.b1, { deadOnArrival: 12_000 })),
      ]),
    ).toEqual(["errors.NOT_FOUND", "errors.INVALID_INPUT", "errors.PLACEMENT_IN_FUTURE", "errors.DEAD_ON_ARRIVAL_TOO_HIGH"]);

    const worker = { ...a, role: "worker" as const };
    expect(await statuses(worker, [m(M.placeBatch, placement(houses.a1))])).toEqual(["errors.FORBIDDEN"]);
    const seen = (await pull(worker, 0, registry)).changes;
    expect(seen.length).toBeGreaterThan(0);
    expect(JSON.stringify(seen)).not.toMatch(/chickUnitPrice/);
    expect((await pull(b, 0, registry)).changes).toEqual([]); // nothing of a's
  });

  it("places every production type with one of its strains, and an M1 placement as a broiler (SPEC-m3 R5)", async () => {
    const [layer, legacy] = [placement(houses.b1, { species: "layer", strainId: "lohmann-brown" }), placement(houses.a2)];
    expect(await statuses(b, [m(M.placeBatch, placement(houses.b1, { species: "turkey" })), m(M.placeBatch, layer)])).toEqual(["errors.INVALID_INPUT", "applied"]);
    expect(await statuses(b, [m(M.placeBatch, placement(houses.b1, { species: "goose", strainId: "lohmann-brown" }))])).toEqual(["errors.INVALID_INPUT"]);
    await db.batch.updateMany({ where: { houseId: houses.a2 }, data: { status: "closed" } });
    expect(await statuses(a, [m(M.placeBatch, legacy)])).toEqual(["applied"]); // queued by an M1 phone: no species
    const pulled = (await pull(b, 0, registry)).changes.map((c) => c.data as BatchDto);
    expect(pulled.find((d) => d.id === layer.id)?.species).toBe("layer");
    expect((await db.batch.findUnique({ where: { id: legacy.id } }))?.species).toBe("broiler");
    await db.batch.updateMany({ where: { houseId: houses.b1 }, data: { status: "closed" } });
  });

  it("lets beldi bands share a run, never with another type (SPEC-m3 B8)", async () => {
    await db.strain.create({ data: { id: "unspecified-beldi", name: "Beldi", productionTypes: ["beldi"] } });
    const band = () => placement(houses.b1, { species: "beldi", strainId: "unspecified-beldi" });
    expect(await statuses(b, [m(M.placeBatch, band()), m(M.placeBatch, band()), m(M.placeBatch, placement(houses.b1))])).toEqual([
      "applied",
      "applied",
      "errors.HOUSE_HAS_OPEN_BATCH",
    ]);
    // The index still holds for every other type, even if a use case forgot to check.
    await expect(db.batch.create({ data: { ...placement(houses.a1), organizationId: a.organizationId, farmId: farmA, chickUnitPriceCentimes: 450n, placedOn: new Date("2026-10-14") } })).rejects.toThrow();
    await db.batch.updateMany({ where: { houseId: houses.b1 }, data: { status: "closed" } });
  });

  it("raises turkeys by sex: two batches in one house, each closing on its own (SPEC-m3 B9)", async () => {
    await db.strain.create({ data: { id: "but-6", name: "BUT 6", productionTypes: ["turkey"] } });
    const turkeys = (sex: string) => placement(houses.b1, { species: "turkey", strainId: "but-6", sex, chicksPlaced: 1500, deadOnArrival: 0 });
    const [hens, toms] = [turkeys("female"), turkeys("male")];
    expect(await statuses(b, [m(M.placeBatch, hens), m(M.placeBatch, toms), m(M.placeBatch, turkeys("male")), m(M.placeBatch, turkeys("mixed"))])).toEqual([
      "applied",
      "applied",
      "errors.HOUSE_HAS_OPEN_BATCH",
      "errors.HOUSE_HAS_OPEN_BATCH",
    ]);
    expect(await statuses(b, [m(M.closeBatch, { batchId: toms.id, day: farmDayOf(new Date()), reason: "Mâles vendus" })])).toEqual(["applied"]);
    const status = async (id: string) => (await db.batch.findUniqueOrThrow({ where: { id } })).status;
    expect([await status(hens.id), await status(toms.id)]).toEqual(["open", "closed"]);
    const pulled = (await pull(b, 0, registry)).changes.map((c) => c.data as BatchDto).find((d) => d.id === hens.id);
    expect(pulled?.sex).toBe("female");
    await db.batch.updateMany({ where: { houseId: houses.b1 }, data: { status: "closed" } });
  });

  it("keeps the chick arrival quality, and the farm's claim threshold (SPEC-m3 B10)", async () => {
    const arrival = placement(houses.b1, { chicksPlaced: 10_000, freeChicks: 200, deadOnArrival: 14, parentFlock: "PS-12", weakChicks: 22, litterTempTenths: 310 });
    expect(await statuses(b, [m(M.placeBatch, arrival)])).toEqual(["applied"]);
    const pulled = (await pull(b, 0, registry)).changes.map((c) => c.data as BatchDto).find((d) => d.id === arrival.id);
    expect(pulled).toMatchObject({ freeChicks: 200, parentFlock: "PS-12", weakChicks: 22, litterTempTenths: 310 });
    await push(b, [m(FARM_MUTATIONS.updateFarm, { id: farmB, changes: { doaClaimThresholdPermille: 5 } })], farmRegistrySync);
    const farm = (await pull(b, 0, farmRegistrySync)).changes.findLast((c) => c.id === farmB)?.data;
    expect(farm).toMatchObject({ doaClaimThresholdPermille: 5, name: "F" });
    await db.batch.updateMany({ where: { houseId: houses.b1 }, data: { status: "closed" } });
  });

  it("refuses a number too big for its column instead of failing the push (T25 S4)", async () => {
    // 2^31 used to pass z.int() and throw on the int4 column: the phone retried it forever, blocking its outbox.
    const results = await statuses(b, [m(M.placeBatch, placement(houses.b1, { chicksPlaced: 2 ** 31 })), m(M.placeBatch, placement(houses.b1))]);
    expect(results).toEqual(["errors.INVALID_INPUT", "applied"]); // the next write still goes through
  });
});
