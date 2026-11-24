import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { placeBatch } from "@/modules/flock";
import { PlaceBatch } from "@/modules/flock/schema";
import { changeAccountingChoices, placementsToPay, postPending, readBooks } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// SPEC-finance §9 "Chicks paid on delivery": a placement sent with what was paid in cash at delivery posts its debt and
// that payment (D 4411 / C 5161, the cash box), so /treasury shows only the rest owed.
type Mutation = { id: string; type: string; payload: unknown; createdAt: string };
const m = <P,>(type: string, payload: P): Mutation => ({ id: uuidv7(), type, payload, createdAt: "2026-10-01T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: Mutation[]) => (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
// 1 000 chicks at 5,50 DH + 100,00 DH of VAT: 5 600,00 DH owed
const placement = (id: string, houseId: string, paidOnDelivery: { cashAccountId: string; amountCentimes: string } | null) => ({
  id,
  houseId,
  species: "broiler",
  strainId: "ross-308",
  placedOn: "2026-10-01",
  chicksPlaced: 1000,
  deadOnArrival: 0,
  hatchery: "Couvoir Atlas",
  deliveryNote: "BL",
  chickUnitPriceCentimes: "550",
  chickVatCentimes: "10000",
  dayOldWeightGrams: null,
  paidOnDelivery,
});
const delivery = (batchId: string) => `placement:${batchId}:pay:delivery`;
const linesOf = async (module: string, sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: module, sourceId } }, include: { entry: true }, orderBy: [{ debitCentimes: "desc" }, { account: "asc" }] })).map((l) => [
    l.entry.journal,
    l.entry.day.toISOString().slice(0, 10),
    l.account,
    l.debitCentimes,
    l.creditCentimes,
    l.treasuryId,
  ]);
const owedOn = async (ctx: TenantContext, batchId: string) => {
  const list = await placementsToPay(ctx);
  if (!list.ok) throw new Error(list.error);
  return list.value.find((p) => p.batchId === batchId)?.owed;
};

describe("chicks paid on delivery (SPEC-finance §9, FN6, FN7)", () => {
  let owner: TenantContext, other: TenantContext;
  const ids = { farm: uuidv7(), box: uuidv7(), bank: uuidv7(), theirBox: uuidv7(), houses: Array.from({ length: 8 }, () => uuidv7()), batches: Array.from({ length: 8 }, () => uuidv7()) };
  const [full, part, unknown, theirs, bank, corrected] = ids.batches;
  const pushed: Mutation[] = [];

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((a) => ({ chart: a.chart, number: a.number, label: a.label, parentNumber: a.parent, fallback: a.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }] });
    owner = await tenant("+212600000031", "Ferme Livraison");
    other = await tenant("+212600000032", "Ferme Voisine");
    expect(await changeAccountingChoices(owner, (await listLegalEntities(owner))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    expect(await statuses(other, m("finance.createTreasuryAccount", { id: ids.theirBox, kind: "cash", name: "Leur caisse" }))).toEqual(["applied"]);
    const paid = (cashAccountId: string, amountCentimes: string) => ({ cashAccountId, amountCentimes });
    pushed.push(
      m("farm-registry.createFarm", { id: ids.farm, name: "Ferme", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      ...ids.houses.map((id, i) => m("farm-registry.createHouse", { id, farmId: ids.farm, name: `B${i + 1}`, areaM2: 1000, capacity: 12000, type: "closed" })),
      m("finance.createTreasuryAccount", { id: ids.box, kind: "cash", name: "Caisse" }),
      m("finance.createTreasuryAccount", { id: ids.bank, kind: "bank", name: "Banque" }),
      m("flock.placeBatch", placement(full, ids.houses[0], paid(ids.box, "560000"))),
      m("flock.placeBatch", placement(part, ids.houses[1], paid(ids.box, "200000"))),
      m("flock.placeBatch", placement(unknown, ids.houses[2], paid(uuidv7(), "560000"))), // no such cash box
      m("flock.placeBatch", placement(theirs, ids.houses[3], paid(ids.theirBox, "560000"))), // another organisation's
      m("flock.placeBatch", placement(bank, ids.houses[4], paid(ids.bank, "560000"))), // a bank account, not a cash box
      m("flock.placeBatch", placement(corrected, ids.houses[5], paid(ids.box, "560000"))),
    );
    expect(await statuses(owner, ...pushed)).toEqual(pushed.map(() => "applied"));
    await postPending(owner);
  });

  it("posts the debt and the payment, on the placement day, from the cash box: nothing left to pay", async () => {
    expect(await linesOf("flock", full)).toEqual([
      ["AC", "2026-10-01", "612121", 560_000n, 0n, null],
      ["AC", "2026-10-01", "4411", 0n, 560_000n, null],
    ]);
    expect(await linesOf("finance", delivery(full))).toEqual([
      ["CA", "2026-10-01", "4411", 560_000n, 0n, null],
      ["CA", "2026-10-01", "5161", 0n, 560_000n, ids.box],
    ]);
    expect((await db.journalEntry.findFirstOrThrow({ where: { sourceId: delivery(full) } })).label).toBe("Paiement fournisseur : Couvoir Atlas");
    expect(await owedOn(owner, full)).toBeUndefined();
  });

  it("paid in part: /treasury shows the rest owed", async () => {
    expect(await linesOf("finance", delivery(part))).toEqual([
      ["CA", "2026-10-01", "4411", 200_000n, 0n, null],
      ["CA", "2026-10-01", "5161", 0n, 200_000n, ids.box],
    ]);
    expect(await owedOn(owner, part)).toBe(360_000n);
  });

  it("a cash box that isn't the organisation's: the debt alone, the payment listed as not posted on /books", async () => {
    for (const id of [unknown, theirs, bank]) {
      expect(await linesOf("flock", id), id).toHaveLength(2); // the debt posts
      expect(await db.journalEntry.count({ where: { sourceId: delivery(id) } }), id).toBe(0);
      expect(await owedOn(owner, id), id).toBe(560_000n);
    }
    const books = await readBooks(owner, "2026-10");
    if (!books.ok) throw new Error(books.error);
    expect(books.value.unpostedDeliveries).toEqual(
      [unknown, theirs, bank].map((batchId) => ({ batchId, placedOn: "2026-10-01", hatchery: "Couvoir Atlas", amountCentimes: 560_000n })),
    );
    expect(await db.journalEntry.count({ where: { organizationId: other.organizationId } })).toBe(0); // nothing in theirs
  });

  it("every entry balances", async () => {
    const entries = await db.journalEntry.findMany({ where: { organizationId: owner.organizationId }, include: { lines: true } });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.lines.reduce((s, l) => s + l.debitCentimes - l.creditCentimes, 0n), e.id).toBe(0n);
  });

  it("posts once: a replayed push, another posting run and a correction leave the payment as it was", async () => {
    const count = () => db.journalEntry.count({ where: { organizationId: owner.organizationId } });
    const before = await count();
    expect(await statuses(owner, ...pushed)).toEqual(pushed.map(() => "applied")); // the same mutation ids
    await postPending(owner);
    expect(await count()).toBe(before);
    // A correction lowering the price under what was paid: the debt is reposted (a reversal and the new version), the
    // payment stays, and the overpaid amount leaves the placement off the list to pay (§9 "Placement debts").
    expect(await statuses(owner, m("flock.correctPlacement", { batchId: corrected, changes: { chickUnitPriceCentimes: "500" } }))).toEqual(["applied"]);
    await postPending(owner);
    expect(await count()).toBe(before + 2);
    expect(await db.journalEntry.count({ where: { sourceId: delivery(corrected) } })).toBe(1);
    expect(await owedOn(owner, corrected)).toBeUndefined();
  });

  it("is refused above the placement's total, and for a role without finance.record (not dropped)", async () => {
    const house = uuidv7();
    expect(await statuses(owner, m("farm-registry.createHouse", { id: house, farmId: ids.farm, name: "B9", areaM2: 1000, capacity: 12000, type: "closed" }))).toEqual(["applied"]);
    expect(await statuses(owner, m("flock.placeBatch", placement(uuidv7(), house, { cashAccountId: ids.box, amountCentimes: "560001" })))).toEqual(["errors.PAID_MORE_THAN_OWED"]);
    const worker = { ...owner, role: "worker" as const };
    expect(await statuses(worker, m("flock.placeBatch", placement(uuidv7(), house, { cashAccountId: ids.box, amountCentimes: "100" })))).toEqual(["errors.FORBIDDEN"]); // flock.manage
    // flock's own check, should a role place batches without finance.record
    const cmd = PlaceBatch.parse(placement(uuidv7(), house, { cashAccountId: ids.box, amountCentimes: "100" }));
    const meta = { mutationId: uuidv7(), deviceCreatedAt: new Date() };
    expect(await db.$transaction((tx) => placeBatch(tx, worker, cmd, meta))).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await db.$transaction((tx) => placeBatch(tx, { ...owner, role: "accountant" }, cmd, meta))).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await db.batch.count({ where: { houseId: house } })).toBe(0);
  });
});
