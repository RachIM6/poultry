import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchResults, changeAccountingChoices, placementsToPay, postPending } from "@/modules/finance";
import { hensAtClose } from "@/modules/finance/application/hens";
import { AccountsFile } from "@/modules/finance/schema";
import type { BatchDto } from "@/modules/flock/schema";
import { tenant, twoTenants } from "@/test/tenant";

// SPEC-finance FN9, FC6: a placement's VAT, on top of the chicks' price. "D 23711 (+ D 34551 for the VAT, FN9)".
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const placementLines = async (batchId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "flock", sourceId: batchId, reversesId: null } }, orderBy: [{ debitCentimes: "desc" }, { account: "asc" }] })).map((l) => [
    l.account,
    l.debitCentimes,
    l.creditCentimes,
  ]);

/** A farm with chicks (1 000 at 4,50 + 900,00 VAT) and point-of-lay hens (500 at 60,00 + 6 000,00 VAT). */
async function placed(ctx: TenantContext, prefix: string) {
  const ids = { farm: uuidv7(), h1: uuidv7(), h2: uuidv7(), h3: uuidv7(), chicks: uuidv7(), hens: uuidv7(), old: uuidv7() };
  const place = (id: string, houseId: string, species: string, strainId: string, price: string, vat: string | undefined, chicks: number, age = 0) =>
    m("flock.placeBatch", {
      id,
      houseId,
      species,
      strainId,
      placedOn: "2026-03-01",
      chicksPlaced: chicks,
      deadOnArrival: 0,
      hatchery: "Couvoir Atlas",
      deliveryNote: "BL",
      chickUnitPriceCentimes: price,
      ...(vat === undefined ? {} : { chickVatCentimes: vat }), // an older phone sends none
      dayOldWeightGrams: null,
      ageAtPlacementDays: age,
    });
  const house = (id: string, name: string) => m("farm-registry.createHouse", { id, farmId: ids.farm, name, areaM2: 1000, capacity: 12000, type: "closed" });
  const pushed = await push(
    ctx,
    [
      m("farm-registry.createFarm", { id: ids.farm, name: `${prefix} Ferme`, region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      house(ids.h1, "B1"),
      house(ids.h2, "B2"),
      house(ids.h3, "B3"),
      place(ids.chicks, ids.h1, "broiler", "ross-308", "450", "90000", 1000),
      place(ids.hens, ids.h2, "layer", "isa-brown", "6000", "600000", 500, 120),
      place(ids.old, ids.h3, "broiler", "ross-308", "450", undefined, 1000),
    ],
    registry,
  );
  expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
  await postPending(ctx);
  return ids;
}

describe("placement VAT (SPEC-finance FN9, FC6)", () => {
  let registered: TenantContext, notRegistered: TenantContext, simpleRegistered: TenantContext, simpleNot: TenantContext;
  let r: Awaited<ReturnType<typeof placed>>, n: typeof r, sr: typeof r, sn: typeof r;

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((a) => ({ chart: a.chart, number: a.number, label: a.label, parentNumber: a.parent, fallback: a.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] }] });
    [registered, notRegistered] = await twoTenants();
    simpleRegistered = await tenant("+212600000003", "Ferme C");
    simpleNot = await tenant("+212600000004", "Ferme D");
    const setups = [[registered, true, "classic"], [notRegistered, false, "classic"], [simpleRegistered, true, "simplified"], [simpleNot, false, "simplified"]] as const;
    for (const [ctx, vatRegistered, hensMethod] of setups) {
      const choices = { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1, vatRegistered, hensMethod };
      expect(await changeAccountingChoices(ctx, (await listLegalEntities(ctx))[0].id, choices)).toMatchObject({ ok: true });
    }
    r = await placed(registered, "A");
    n = await placed(notRegistered, "B");
    sr = await placed(simpleRegistered, "C");
    sn = await placed(simpleNot, "D");
  });

  it("a registered entity recovers it: 34552 on chicks, 34551 on point-of-lay hens, the debt on top of the price", async () => {
    expect(await placementLines(r.chicks)).toEqual([
      ["612121", 450_000n, 0n],
      ["34552", 90_000n, 0n],
      ["4411", 0n, 540_000n],
    ]);
    expect(await placementLines(r.hens)).toEqual([
      ["23711", 3_000_000n, 0n],
      ["34551", 600_000n, 0n],
      ["4481", 0n, 3_600_000n],
    ]);
  });

  it("an entity not registered keeps it in the cost", async () => {
    expect(await placementLines(n.chicks)).toEqual([
      ["612121", 540_000n, 0n],
      ["4411", 0n, 540_000n],
    ]);
    expect(await placementLines(n.hens)).toEqual([
      ["23711", 3_600_000n, 0n],
      ["4481", 0n, 3_600_000n],
    ]);
  });

  it("a placement from an older phone has none", async () => {
    expect(await placementLines(r.old)).toEqual([
      ["612121", 450_000n, 0n],
      ["4411", 0n, 450_000n],
    ]);
    expect((await db.batch.findUniqueOrThrow({ where: { id: r.old } })).chickVatCentimes).toBeNull();
  });

  it("the debt to pay includes the VAT", async () => {
    const owed = await placementsToPay(registered);
    expect(owed.ok && Object.fromEntries(owed.value.map((p) => [p.batchId, p.owed]))).toEqual({ [r.chicks]: 540_000n, [r.hens]: 3_600_000n, [r.old]: 450_000n });
  });

  it("counts it in the batch's chick cost (FN13, FQ30: amounts with VAT), registered or not", async () => {
    for (const ctx of [registered, notRegistered]) {
      const rows = await batchResults(ctx);
      if (!rows.ok) throw new Error(rows.error);
      const chicksOf = (id: string) => rows.value.find((x) => x.id === id)?.costs.chicks;
      expect([chicksOf(ctx === registered ? r.chicks : n.chicks), chicksOf(ctx === registered ? r.old : n.old)]).toEqual([540_000n, 450_000n]);
    }
  });

  it("values point-of-lay hens under the simplified method as posted: without the VAT a registered entity recovered (FC6)", async () => {
    const year = { from: "2026-01-01" as FarmDay, to: "2026-12-31" as FarmDay };
    const entryOf = async (ctx: TenantContext, hens: string) => {
      const entity = (await listLegalEntities(ctx))[0];
      const close = await db.$transaction((tx) => hensAtClose(tx, ctx, entity, year));
      return [close.method, close.lines.find((l) => l.id === hens)?.entry];
    };
    expect(await entryOf(simpleRegistered, sr.hens)).toEqual(["simplified", 3_000_000n]);
    expect(await entryOf(simpleNot, sn.hens)).toEqual(["simplified", 3_600_000n]);
    expect(await placementLines(sr.hens)).toEqual([
      ["612121", 3_000_000n, 0n],
      ["34552", 600_000n, 0n],
      ["4411", 0n, 3_600_000n],
    ]); // not an asset under the simplified method: the VAT is recovered on the charges
  });

  it("closing the batch keeps it: the closing's version posts nothing new (FN7)", async () => {
    const entries = () => db.journalEntry.count({ where: { organizationId: registered.organizationId, sourceModule: "flock", sourceId: r.chicks } });
    const before = await entries();
    const closed = await push(registered, [m("flock.closeBatch", { batchId: r.chicks, day: "2026-03-10", reason: "Test" })], registry);
    expect(closed.results.map((x) => x.status)).toEqual(["applied"]);
    await postPending(registered);
    expect(await entries()).toBe(before);
    expect(await placementLines(r.chicks)).toEqual([
      ["612121", 450_000n, 0n],
      ["34552", 90_000n, 0n],
      ["4411", 0n, 540_000n],
    ]);
  });

  it("is money: workers don't receive it (SPEC I5)", async () => {
    const batchOf = async (ctx: TenantContext) => (await pull(ctx, 0, registry)).changes.filter((c) => c.entity === "batch" && c.id === r.hens).at(-1)?.data as BatchDto;
    expect((await batchOf(registered)).chickVatCentimes).toBe("600000");
    expect(await batchOf({ ...registered, role: "worker" })).not.toHaveProperty("chickVatCentimes");
  });
});
