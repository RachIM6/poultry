import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { batchResults, postPending, setPeriodLocked } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import type { BatchDto } from "@/modules/flock/schema";
import { twoTenants } from "@/test/tenant";

// SPEC B6 "Reopening" (decided default, to review): the owner reopens a closed batch, fixes its last sale, closes it
// again; finance releases its frozen shares, then freezes them anew, and the books follow by reversal and new entry.
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-20T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const result = async (ctx: TenantContext, id: string) => {
  const r = await batchResults(ctx);
  if (!r.ok) throw new Error(r.error);
  return r.value.find((x) => x.id === id)!;
};
/** The ledger's net for a source: Σdebit − Σcredit per account, its reversals included, zero lines left out. */
const net = async (sourceId: string) => {
  const ids = (await db.journalEntry.findMany({ where: { sourceId }, select: { id: true } })).map((e) => e.id);
  const lines = await db.journalLine.findMany({ where: { entry: { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] } } });
  const out = new Map<string, bigint>();
  for (const l of lines) out.set(l.account, (out.get(l.account) ?? 0n) + l.debitCentimes - l.creditCentimes);
  return Object.fromEntries([...out].filter(([, v]) => v !== 0n));
};

describe("reopening a closed batch (SPEC B6)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), h1: uuidv7(), h2: uuidv7(), h3: uuidv7(), h4: uuidv7(), batchA: uuidv7(), batchB: uuidv7(), pullets: uuidv7(), buyer: uuidv7() };
  const sale = (farmWeightGrams: number) =>
    m("sales.recordSale", { id: uuidv7(), batchId: ids.batchA, buyerId: ids.buyer, day: "2026-11-02", birds: 1000, farmWeightGrams, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: String((farmWeightGrams / 1000) * 1500), instrument: null });
  const reopen = (batchId = ids.batchA, reason = "Poids de la dernière vente mal saisi") => m("flock.reopenBatch", { batchId, reason });
  const place = (id: string, houseId: string, placedOn: string, more: object = {}) =>
    m("flock.placeBatch", { id, houseId, strainId: "ross-308", placedOn, chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null, ...more });
  const stored = () => db.batch.findUniqueOrThrow({ where: { id: ids.batchA } });
  const frozenRows = () => db.frozenAllocation.count({ where: { batchId: ids.batchA } });
  let wrongSale: PushedMutation;
  let entity: string;

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "lohmann-brown", name: "Lohmann Brown", productionTypes: ["pullet", "layer"] }] });
    [a, b] = await twoTenants();
    entity = (await listLegalEntities(a))[0].id;
    const house = (id: string, name: string) => m("farm-registry.createHouse", { id, farmId: ids.farm, name, areaM2: 1000, capacity: 10000, type: "closed" });
    wrongSale = sale(2_000_000); // 2 000 kg typed for 2 100 kg
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        house(ids.h1, "B1"),
        house(ids.h2, "B2"),
        house(ids.h3, "P1"),
        house(ids.h4, "P2"),
        place(ids.batchA, ids.h1, "2026-09-20"), // all of October: 31 × 1 000 = 31 000 bird-days
        place(ids.batchB, ids.h2, "2026-10-16", { chicksPlaced: 500 }), // 16–31 October: 16 × 500 = 8 000 bird-days
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        // October's electricity, 3 900,00, shared by bird-days: A 3 100,00, B 800,00 (FN14)
        m("finance.recordExpense", { id: uuidv7(), day: "2026-11-05", category: "electricity", amountCentimes: "390000", paidFrom: "credit", treasuryId: null, note: null, batchId: null, serviceMonth: "2026-10" }),
        wrongSale, // A's last birds: it closes
      ),
    ).toEqual(Array(10).fill("applied"));
    await postPending(a); // posts the sale, freezes A
    expect(await result(a, ids.batchA)).toMatchObject({ frozen: true, closedOn: "2026-11-02", salesCentimes: 3_000_000n, costs: { allocated: 310_000n } });
    expect(await frozenRows()).toBe(1);
    expect(await statuses(a, m("sales.cancelSale", { saleId: (wrongSale.payload as { id: string }).id }))).toEqual(["BATCH_CLOSED"]); // closed: final until reopened
   }, 60_000);

  it("is the owner's alone, each organisation its own", async () => {
    for (const role of ["manager", "accountant", "worker", "vet"] as const) expect(await statuses({ ...a, role }, reopen()), role).toEqual(["FORBIDDEN"]);
    expect(await statuses(b, reopen())).toEqual(["NOT_FOUND"]);
    expect(await statuses(a, reopen(ids.batchA, ""))).toEqual(["INVALID_INPUT"]); // a reason is required
    expect((await stored()).status).toBe("closed");
  });

  it("is refused while its closing's month is locked or its fiscal year closed, changing nothing", async () => {
    const changes = await db.change.count({ where: { organizationId: a.organizationId } });
    expect(await setPeriodLocked(a, entity, "2026-11", true)).toEqual({ ok: true, value: undefined });
    expect(await statuses(a, reopen())).toEqual(["PERIOD_LOCKED"]);
    expect(await setPeriodLocked(a, entity, "2026-11", false)).toEqual({ ok: true, value: undefined });

    await db.fiscalYearClose.create({ data: { organizationId: a.organizationId, legalEntityId: entity, day: new Date("2026-12-31T00:00:00Z"), closedBy: a.userId, closedAt: new Date() } });
    expect(await statuses(a, reopen())).toEqual(["YEAR_CLOSED"]);
    await db.fiscalYearClose.deleteMany({ where: { legalEntityId: entity } });

    expect([(await stored()).status, await frozenRows(), await db.frozenBatch.count({ where: { batchId: ids.batchA } })]).toEqual(["closed", 1, 1]);
    expect(await db.change.count({ where: { organizationId: a.organizationId } })).toBe(changes);
  });

  it("reopens it: open again in its house, its closing cleared and audited, its shares released, once per mutation", async () => {
    const given = reopen();
    expect(await statuses(a, given)).toEqual(["applied"]);
    const changes = await db.change.count({ where: { organizationId: a.organizationId } });
    expect(await statuses(a, given)).toEqual(["applied"]); // replayed: its stored result, nothing more
    expect(await db.change.count({ where: { organizationId: a.organizationId } })).toBe(changes);
    expect(await statuses(a, reopen())).toEqual(["BATCH_NOT_CLOSED"]); // reopened once

    expect(await stored()).toMatchObject({ status: "open", closedOn: null, closeReason: null, soldGrams: null, costCentimes: null, costPerKgCentimes: null });
    const pulled = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "batch" && c.id === ids.batchA).at(-1)?.data as BatchDto;
    expect(pulled.status).toBe("open");
    expect(pulled).not.toHaveProperty("closedOn"); // the phone drops its closing with the record it replaces
    expect(await statuses(a, place(uuidv7(), ids.h1, "2026-11-20"))).toEqual(["HOUSE_HAS_OPEN_BATCH"]); // occupied again

    const audited = await db.auditEvent.findFirstOrThrow({ where: { entity: "Batch", entityId: ids.batchA, action: "reopen" } });
    expect(audited).toMatchObject({ mutationId: given.id, userId: a.userId, after: { status: "open", reason: "Poids de la dernière vente mal saisi" } });
    expect(audited.before).toMatchObject({ status: "closed", closedOn: "2026-11-02", closeReason: null, soldGrams: 2_000_000 });
    const released = await db.auditEvent.findFirstOrThrow({ where: { entity: "FrozenBatch", entityId: ids.batchA, action: "unfreeze" } });
    expect(released.before).toEqual({ shares: [{ expenseId: expect.any(String), amountCentimes: "310000" }] });
    expect(await db.frozenBatch.count({ where: { batchId: ids.batchA } })).toBe(0);

    // A closing posts no entry, so neither does a reopening; the result is live again, by the same key
    expect(await postPending(a)).toBe(0);
    expect(await result(a, ids.batchA)).toMatchObject({ frozen: false, closedOn: null, costs: { allocated: 310_000n } });
    expect((await result(a, ids.batchB)).costs.allocated).toBe(80_000n);
  });

  it("then the wrong sale is cancelled and typed again: the batch closes again, re-frozen, its books reversed and posted again", async () => {
    const wrongId = (wrongSale.payload as { id: string }).id;
    expect(await net(wrongId)).toEqual({ "5161": 3_000_000n, "712121": -3_000_000n });
    expect(await statuses(a, m("sales.cancelSale", { saleId: wrongId }))).toEqual(["applied"]);
    expect((await stored()).status).toBe("open"); // its birds came back
    const right = sale(2_100_000);
    expect(await statuses(a, right)).toEqual(["applied"]);
    expect(await stored()).toMatchObject({ status: "closed", soldGrams: 2_100_000 }); // the last birds sold again
    expect(await postPending(a)).toBe(2); // the wrong sale's reversal, the right one's entry

    expect(await net(wrongId)).toEqual({});
    expect(await net((right.payload as { id: string }).id)).toEqual({ "5161": 3_150_000n, "712121": -3_150_000n });
    const sums = await db.journalLine.aggregate({ where: { organizationId: a.organizationId }, _sum: { debitCentimes: true, creditCentimes: true } });
    expect(sums._sum.debitCentimes).toBe(sums._sum.creditCentimes); // balanced

    // FN13: frozen again with its new facts. 5 500,00 chicks + 3 100,00 allocated = 8 600,00 for 31 500,00 of sales
    expect(await result(a, ids.batchA)).toMatchObject({ frozen: true, closedOn: "2026-11-02", soldGrams: 2_100_000, salesCentimes: 3_150_000n, costCentimes: 860_000n, marginCentimes: 2_290_000n, costs: { allocated: 310_000n } });
    expect([await frozenRows(), await db.frozenBatch.count({ where: { batchId: ids.batchA } })]).toEqual([1, 1]);
    expect(await db.auditEvent.count({ where: { entity: "Batch", entityId: ids.batchA, action: "close" } })).toBe(2);
  });

  it("is refused once its house was cleaned out since it closed (BS4), changing nothing", async () => {
    const [house, batch] = [uuidv7(), uuidv7()];
    expect(
      await statuses(
        a,
        m("farm-registry.createHouse", { id: house, farmId: ids.farm, name: "B5", areaM2: 1000, capacity: 10000, type: "closed" }),
        place(batch, house, "2026-09-25"),
        m("sales.recordSale", { id: uuidv7(), batchId: batch, buyerId: ids.buyer, day: "2026-11-03", birds: 1000, farmWeightGrams: 2_000_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "3000000", instrument: null }),
        m("biosecurity.startCleanout", { id: uuidv7(), houseId: house, afterBatchId: batch, startedOn: "2026-11-04" }),
      ),
    ).toEqual(Array(4).fill("applied"));
    await postPending(a); // freezes it
    const frozen = () => db.frozenAllocation.count({ where: { batchId: batch } }).then(async (n) => [n, await db.frozenBatch.count({ where: { batchId: batch } })]);
    const before = [await frozen(), await db.change.count({ where: { organizationId: a.organizationId } })];
    expect(await statuses(a, reopen(batch))).toEqual(["CLEANOUT_STARTED"]);
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch } })).status).toBe("closed");
    expect([await frozen(), await db.change.count({ where: { organizationId: a.organizationId } })]).toEqual(before);
    expect(await db.auditEvent.count({ where: { entityId: batch, action: { in: ["reopen", "unfreeze"] } } })).toBe(0);
  });

  it("is refused once its house took a newer batch, and for pullets moved to laying", async () => {
    expect(await statuses(a, place(uuidv7(), ids.h1, "2026-11-10"))).toEqual(["applied"]);
    expect(await statuses(a, reopen())).toEqual(["HOUSE_HAS_NEWER_BATCH"]);
    expect([await frozenRows(), await db.frozenBatch.count({ where: { batchId: ids.batchA } })]).toEqual([1, 1]); // finance's release rolled back

    expect(
      await statuses(
        a,
        place(ids.pullets, ids.h3, "2026-06-01", { species: "pullet", strainId: "lohmann-brown" }),
        m("flock.transferToLaying", { batchId: ids.pullets, day: "2026-11-01", newBatchId: uuidv7(), houseId: ids.h4, hens: 1000 }),
      ),
    ).toEqual(["applied", "applied"]);
    expect(await statuses(a, reopen(ids.pullets))).toEqual(["BATCH_TRANSFERRED"]);
    expect((await db.batch.findUniqueOrThrow({ where: { id: ids.pullets } })).status).toBe("closed");
  });
});
