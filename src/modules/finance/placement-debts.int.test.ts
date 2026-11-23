import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, payPlacement, placementsToPay, postPending, readBooks, setPeriodLocked, treasuryOverview } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant, twoTenants } from "@/test/tenant";

// SPEC-finance §9 "Placement debts": paying a placement's chicks (D 4411) or point-of-lay hens (FC6 classic, D 4481).
const clock = fixedClock("2026-06-15T10:00:00Z");
const OK = { ok: true, value: undefined };
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "finance", sourceId } }, include: { entry: true }, orderBy: { debitCentimes: "desc" } })).map((l) => [
    l.entry.journal,
    l.entry.day.toISOString().slice(0, 10),
    l.account,
    l.debitCentimes,
    l.creditCentimes,
    l.treasuryId,
  ]);
const paymentsOf = (batchId: string) => db.journalEntry.count({ where: { sourceModule: "finance", sourceId: { startsWith: `placement:${batchId}:pay:` } } });

/** A farm, two houses, a cash box and a bank account; chicks (1 000 at 5,50) and point-of-lay hens (500 at 60,00) placed. */
async function farmWithPlacements(ctx: TenantContext, prefix: string) {
  const ids = { farm: uuidv7(), h1: uuidv7(), h2: uuidv7(), h3: uuidv7(), chicks: uuidv7(), hens: uuidv7(), free: uuidv7(), box: uuidv7(), bank: uuidv7() };
  const place = (id: string, houseId: string, species: string, strainId: string, placedOn: string, chicks: number, price: string, hatchery: string, age = 0) =>
    m("flock.placeBatch", { id, houseId, species, strainId, placedOn, chicksPlaced: chicks, deadOnArrival: 0, hatchery, deliveryNote: "BL", chickUnitPriceCentimes: price, dayOldWeightGrams: null, ageAtPlacementDays: age });
  const house = (id: string, name: string) => m("farm-registry.createHouse", { id, farmId: ids.farm, name, areaM2: 1000, capacity: 12000, type: "closed" });
  const pushed = await push(
    ctx,
    [
      m("farm-registry.createFarm", { id: ids.farm, name: `${prefix} Ferme`, region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      house(ids.h1, "B1"),
      house(ids.h2, "B2"),
      house(ids.h3, "B3"),
      m("finance.createTreasuryAccount", { id: ids.box, kind: "cash", name: "Caisse" }),
      m("finance.createTreasuryAccount", { id: ids.bank, kind: "bank", name: "Banque" }),
      place(ids.chicks, ids.h1, "broiler", "ross-308", "2026-03-01", 1000, "550", "Couvoir Atlas"),
      place(ids.hens, ids.h2, "layer", "isa-brown", "2026-03-05", 500, "6000", "Élevage Souss", 120),
      place(ids.free, ids.h3, "broiler", "ross-308", "2026-03-06", 1000, "0", "Couvoir Atlas"), // no price: nothing owed
    ],
    registry,
  );
  expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
  await postPending(ctx);
  return ids;
}

describe("placement debts (SPEC-finance §9, FN6, FC6)", () => {
  let owner: TenantContext, cashBook: TenantContext, other: TenantContext;
  let o: Awaited<ReturnType<typeof farmWithPlacements>>, c: typeof o, x: typeof o;
  const pay = (batchId: string, more: object = {}) => ({ id: uuidv7(), batchId, day: "2026-04-10", amountCentimes: "100000", paidWith: "cash", treasuryId: null, ...more });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((a) => ({ chart: a.chart, number: a.number, label: a.label, parentNumber: a.parent, fallback: a.fallback })) });
    await db.strain.createMany({ data: [{ id: "ross-308", name: "Ross 308" }, { id: "isa-brown", name: "ISA Brown", productionTypes: ["pullet", "layer"] }] });
    [owner, cashBook] = await twoTenants(); // individuals: the second keeps its default cash_book
    other = await tenant("+212600000003", "Ferme C");
    for (const ctx of [owner, other]) {
      expect(await changeAccountingChoices(ctx, (await listLegalEntities(ctx))[0].id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true }); // classic hens (FQ7a)
    }
    o = await farmWithPlacements(owner, "A");
    c = await farmWithPlacements(cashBook, "B");
    x = await farmWithPlacements(other, "C");
  });

  it("lists the placements still owed, oldest first, with the hatchery typed at placement and the debt's account", async () => {
    expect(await placementsToPay(owner)).toEqual({
      ok: true,
      value: [
        { batchId: o.chicks, hatchery: "Couvoir Atlas", place: "A Ferme · B1", placedOn: "2026-03-01", account: "4411", owed: 550_000n },
        { batchId: o.hens, hatchery: "Élevage Souss", place: "A Ferme · B2", placedOn: "2026-03-05", account: "4481", owed: 3_000_000n },
      ],
    });
  });

  it("pays the chicks, D 4411 / C the cash box, once per form, up to what is owed", async () => {
    const first = pay(o.chicks, { amountCentimes: "200000", treasuryId: o.box });
    expect(await payPlacement(owner, first, clock)).toEqual(OK);
    expect(await payPlacement(owner, first, clock)).toEqual(OK); // the same form again
    expect(await linesOf(`placement:${o.chicks}:pay:${first.id}`)).toEqual([
      ["CA", "2026-04-10", "4411", 200_000n, 0n, null],
      ["CA", "2026-04-10", "5161", 0n, 200_000n, o.box],
    ]);
    expect((await db.journalEntry.findFirstOrThrow({ where: { sourceId: `placement:${o.chicks}:pay:${first.id}` } })).label).toBe("Paiement fournisseur : Couvoir Atlas");
    expect(await payPlacement(owner, pay(o.chicks, { amountCentimes: "350001" }), clock)).toEqual({ ok: false, error: "PAID_MORE_THAN_OWED" });
    expect(await payPlacement(owner, pay(o.chicks, { amountCentimes: "350000", paidWith: "transfer", treasuryId: o.bank }), clock)).toEqual(OK);
    expect(await payPlacement(owner, pay(o.chicks, { amountCentimes: "1" }), clock)).toEqual({ ok: false, error: "NOTHING_OWED" });
    expect(await paymentsOf(o.chicks)).toBe(2);
    const audited = await db.auditEvent.findFirstOrThrow({ where: { organizationId: owner.organizationId, entity: "PlacementDebt", entityId: o.chicks, action: "pay" }, orderBy: { id: "asc" } });
    expect(audited.after).toMatchObject({ paymentId: first.id, amountCentimes: "200000", paidWith: "cash", treasuryId: o.box, account: "4411" });
    const list = await placementsToPay(owner);
    expect(list.ok && list.value.map((p) => p.batchId)).toEqual([o.hens]); // paid off: off the list
  });

  it("pays point-of-lay hens under the classic method on 4481, by cheque from the bank (BQ)", async () => {
    const p = pay(o.hens, { amountCentimes: "1000000", paidWith: "cheque", treasuryId: o.bank });
    expect(await payPlacement(owner, p, clock)).toEqual(OK);
    expect(await linesOf(`placement:${o.hens}:pay:${p.id}`)).toEqual([
      ["BQ", "2026-04-10", "4481", 1_000_000n, 0n, null],
      ["BQ", "2026-04-10", "5141", 0n, 1_000_000n, o.bank],
    ]);
    const list = await placementsToPay(owner);
    expect(list.ok && list.value.find((x) => x.batchId === o.hens)?.owed).toBe(2_000_000n);
  });

  it("shows the payment on the treasury with its batch (FN10, FN18)", async () => {
    const treasury = await treasuryOverview(owner, "2026-04");
    if (!treasury.ok) throw new Error(treasury.error);
    expect(treasury.value.movements.find((mv) => mv.label === "Paiement fournisseur : Élevage Souss")).toMatchObject({ creditCentimes: 1_000_000n, treasuryId: o.bank, batch: "B2 · 05/03/2026" });
  });

  it("refuses, writing nothing: nothing owed, the wrong kind of account, another's account, a future day, a locked month, bad input", async () => {
    const entries = () => db.journalEntry.count({ where: { organizationId: owner.organizationId } });
    const before = await entries();
    expect(await payPlacement(owner, pay(o.free), clock)).toEqual({ ok: false, error: "NOTHING_OWED" }); // placed without a price
    expect(await payPlacement(owner, pay(o.hens, { treasuryId: o.bank }), clock)).toEqual({ ok: false, error: "TREASURY_ACCOUNT_MISMATCH" }); // cash from a bank account
    expect(await payPlacement(owner, pay(o.hens, { paidWith: "transfer", treasuryId: o.box }), clock)).toEqual({ ok: false, error: "TREASURY_ACCOUNT_MISMATCH" });
    expect(await payPlacement(owner, pay(o.hens, { treasuryId: x.box }), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await payPlacement(owner, pay(o.hens, { day: "2026-06-17" }), clock)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    expect(await payPlacement(owner, pay(o.hens, { amountCentimes: "0" }), clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await payPlacement(owner, pay(o.hens, { paidWith: "credit" }), clock)).toEqual({ ok: false, error: "INVALID_INPUT" });
    const entity = (await listLegalEntities(owner))[0].id;
    expect(await setPeriodLocked(owner, entity, "2026-05", true)).toEqual(OK);
    expect(await payPlacement(owner, pay(o.hens, { day: "2026-05-20" }), clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await setPeriodLocked(owner, entity, "2026-05", false)).toEqual(OK);
    expect(await entries()).toBe(before);
  });

  it("takes two payments at once one after the other: both capped by the same debt", async () => {
    const both = await Promise.all([1, 2].map(() => payPlacement(other, pay(x.chicks, { amountCentimes: "550000" }), clock).catch((e) => e)));
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.filter((r) => !r.ok)).toEqual([{ ok: false, error: "NOTHING_OWED" }]);
    expect(await paymentsOf(x.chicks)).toBe(1);
  });

  it("is the owner's and the manager's; the accountant and workers neither list nor pay", async () => {
    const manager = { ...owner, role: "manager" as const };
    expect(await payPlacement(manager, pay(o.hens, { amountCentimes: "500000" }), clock)).toEqual(OK);
    expect((await placementsToPay(manager)).ok).toBe(true);
    for (const role of ["accountant", "worker", "vet"] as const) {
      const ctx = { ...owner, role };
      expect(await payPlacement(ctx, pay(o.hens), clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await placementsToPay(ctx), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
  });

  it("keeps each organisation to its own placements", async () => {
    const before = await paymentsOf(o.hens);
    expect(await payPlacement(other, pay(o.hens), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await paymentsOf(o.hens)).toBe(before);
    const theirs = await placementsToPay(other);
    expect(theirs.ok && theirs.value.map((p) => p.batchId)).toEqual([x.hens]); // x.chicks paid off above
    // The same form id in two organisations: two payments, each on its own placement.
    const id = uuidv7();
    expect(await payPlacement(owner, pay(o.hens, { id }), clock)).toEqual(OK);
    expect(await payPlacement(other, pay(x.hens, { id }), clock)).toEqual(OK);
    expect(await db.journalEntry.count({ where: { sourceId: { endsWith: `:pay:${id}` } } })).toBe(2);
  });

  it("posts a cash_book entity's payment too: its placement posted the debt, and the money leaving shows in its cash book", async () => {
    expect((await listLegalEntities(cashBook))[0].accountingProfile.books).toBe("cash_book");
    expect(await payPlacement(cashBook, pay(c.chicks, { amountCentimes: "550000", treasuryId: c.box }), clock)).toEqual(OK);
    const books = await readBooks(cashBook, "2026-04");
    if (!books.ok) throw new Error(books.error);
    expect(books.value.cashBook.rows.map((r) => [r.day, r.label, r.account, r.counterAccounts, r.receipt, r.expense])).toEqual([
      ["2026-04-10", "Paiement fournisseur : Couvoir Atlas", "5161", ["4411"], 0n, 550_000n],
    ]);
    const list = await placementsToPay(cashBook);
    expect(list.ok && list.value.map((p) => [p.batchId, p.account])).toEqual([[c.hens, "4411"]]); // no classic hens without a ledger (FC6)
  });
});
