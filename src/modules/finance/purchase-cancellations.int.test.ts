import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { farmDayOf } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { catchUpBooks, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { INVENTORY_MUTATIONS as M } from "@/modules/inventory/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-finance §9 "Cancelled records": a purchase cancelled, its stock and its entry with it.
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-20T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey.replace("errors.", "") : r.status));
const today = farmDayOf(new Date());

describe("cancelled purchases (SPEC-finance §9)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), supplier: uuidv7(), feed: uuidv7() };
  const onHand = async () => (await db.stockMovement.aggregate({ where: { stockItemId: ids.feed }, _sum: { quantity: true } }))._sum.quantity ?? 0;
  const purchase = (over: object = {}) =>
    m(M.recordPurchase, { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: today, quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null, ...over });
  const idOf = (x: PushedMutation) => (x.payload as { id: string }).id;
  const cancel = (purchaseId: string) => m(M.cancelPurchase, { purchaseId });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [a, b] = await twoTenants();
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m(M.createSupplier, { id: ids.supplier, name: "Alf", phone: null }),
        m(M.createStockItem, { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
      ),
    ).toEqual(Array(3).fill("applied"));
  });

  it("cancels a purchase: its stock goes, the supplier is owed nothing for it, the phones drop it, the books reverse it", async () => {
    const bought = purchase({ quantity: 2_000_000, unitPriceCentimes: "4500" }); // 2 t at 45,00 a kg: a typo for 4,50
    expect(await statuses(a, bought)).toEqual(["applied"]);
    expect(await postPending(a)).toBe(1);
    expect(await onHand()).toBe(2_000_000);

    const cancelled = cancel(idOf(bought));
    expect(await statuses(a, cancelled, cancelled)).toEqual(["applied", "applied"]); // a replay: its stored result
    expect(await statuses(a, cancel(idOf(bought)))).toEqual(["NOT_FOUND"]);
    expect([await onHand(), await db.purchase.count({ where: { id: idOf(bought) } })]).toEqual([0, 0]);
    const { changes } = await pull(a, 0, registry);
    const movementId = (bought.payload as { movementId: string }).movementId;
    expect(changes.filter((c) => c.id === movementId).at(-1)).toMatchObject({ entity: "movement", data: null });
    expect(changes.filter((c) => c.id === idOf(bought)).at(-1)).toMatchObject({ entity: "purchase", data: null });

    await catchUpBooks(a); // the cancellation alone makes the books pending (§9 "Postings catch up")
    const entry = await db.journalEntry.findFirstOrThrow({ where: { sourceModule: "inventory", sourceId: idOf(bought) } });
    const reversal = await db.journalEntry.findFirstOrThrow({ where: { reversesId: entry.id }, include: { lines: true } });
    expect(reversal.lines.map((l) => [l.account, l.debitCentimes, l.creditCentimes]).sort()).toEqual([["4411", 9_000_000n, 0n], ["612122", 0n, 9_000_000n]]);
    const audited = await db.auditEvent.findFirstOrThrow({ where: { entity: "Purchase", entityId: idOf(bought), action: "cancel" } });
    expect(audited.before).toMatchObject({ id: idOf(bought), amountCentimes: "9000000", movements: [{ id: movementId, quantity: 2_000_000 }] });
  });

  it("refuses, writing nothing, once some of its stock was used, the supplier was paid for it, or the bank debited its cheque", async () => {
    const used = purchase({ paidCentimes: "450000" }); // paid at once
    expect(await statuses(a, used, m(M.adjustStock, { id: uuidv7(), stockItemId: ids.feed, day: today, quantity: -1000, reason: "Sac percé" }))).toEqual(["applied", "applied"]);
    const paid = purchase(); // on credit, then paid
    const cheque = purchase({ paidCentimes: "450000", paidMethod: "cheque" });
    expect(await statuses(a, paid, m(M.recordSupplierPayment, { id: uuidv7(), supplierId: ids.supplier, day: today, amountCentimes: "450000", method: "cash" }), cheque, m(M.debitIssued, { id: uuidv7(), instrumentId: idOf(cheque), day: today }))).toEqual(Array(4).fill("applied"));
    const changes = await db.change.count();
    expect(await statuses(a, cancel(idOf(paid)), cancel(idOf(cheque)))).toEqual(["PURCHASE_HAS_PAYMENT", "PURCHASE_HAS_PAYMENT"]);
    expect(await db.change.count()).toBe(changes);
    expect(await statuses(a, cancel(idOf(used)))).toEqual(["applied"]); // 3 t − 1 kg on hand ≥ its 1 t
    expect(await onHand()).toBe(1_999_000);
    expect(await statuses(a, m(M.adjustStock, { id: uuidv7(), stockItemId: ids.feed, day: today, quantity: -1_500_000, reason: "Distribué" }))).toEqual(["applied"]);
    const last = purchase({ quantity: 100_000 });
    expect(await statuses(a, last, m(M.adjustStock, { id: uuidv7(), stockItemId: ids.feed, day: today, quantity: -500_000, reason: "Distribué" }))).toEqual(["applied", "applied"]);
    expect(await statuses(a, cancel(idOf(last)))).toEqual(["STOCK_ALREADY_USED"]); // 99 kg on hand < 100 kg
  });

  it("is for those who manage the stock, each organisation its own", async () => {
    const bought = purchase();
    expect(await statuses(a, bought)).toEqual(["applied"]);
    expect(await statuses({ ...a, role: "worker" }, cancel(idOf(bought)))).toEqual(["FORBIDDEN"]);
    expect(await statuses(b, cancel(idOf(bought)))).toEqual(["NOT_FOUND"]);
    expect(await db.purchase.count({ where: { id: idOf(bought) } })).toBe(1);
    expect(await statuses({ ...a, role: "manager" }, cancel(idOf(bought)))).toEqual(["applied"]);
  });
});
