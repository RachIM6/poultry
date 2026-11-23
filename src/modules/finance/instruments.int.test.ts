import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceId } }, orderBy: { account: "asc" } })).map((l) => [l.account, l.debitCentimes, l.creditCentimes]);

describe("cheques and bills received (SPEC-finance FN6, FN11, FN12, T31)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), buyer: uuidv7(), sale: uuidv7(), payment: uuidv7() };
  // 500 birds, 1 000 kg at 12,00 DH/kg = 12 000,00 DH.
  const sale = (id: string, method: string, paid: string, instrument: object | null = null) =>
    m("sales.recordSale", { id, batchId: ids.batch, buyerId: ids.buyer, day: "2026-03-10", birds: 500, farmWeightGrams: 1_000_000, buyerWeightGrams: null, pricePerKgCentimes: "1200", paymentMethod: method, paidCentimes: paid, instrument });
  const step = (instrumentId: string, state: string, day = "2026-03-12") => m("sales.setInstrumentState", { id: uuidv7(), instrumentId, state, day });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a, b] = await twoTenants();
    expect(
      await statuses(
        a,
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2026-02-01", chicksPlaced: 5000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
      ),
    ).toEqual(["applied", "applied", "applied", "applied"]);
  });

  it("posts a sale paid in part by cheque, then the cheque coming back unpaid, which blocks the buyer's credit", async () => {
    expect(await statuses(a, sale(ids.sale, "cheque", "500000", { number: "CHQ-1", dueOn: "2026-03-20" }))).toEqual(["applied"]);
    const unpaid = step(ids.sale, "unpaid");
    expect(await statuses(a, unpaid)).toEqual(["applied"]);
    expect(await statuses(a, step(ids.sale, "cashed"))).toEqual(["errors.INVALID_TRANSITION"]); // unpaid is final

    await postPending(a);
    expect(await linesOf(ids.sale)).toEqual([["3421", 1_200_000n, 0n], ["3421", 0n, 500_000n], ["51111", 500_000n, 0n], ["712121", 0n, 1_200_000n]]);
    expect(await linesOf(unpaid.payload.id)).toEqual([["3424", 500_000n, 0n], ["51111", 0n, 500_000n]]);

    // FN12: no more credit, but a sale paid in full is fine; the 5 000,00 is owed again (7 000,00 + 5 000,00).
    expect(await statuses(a, sale(uuidv7(), "credit", "0"))).toEqual(["errors.BUYER_CREDIT_BLOCKED"]);
    expect(await statuses(a, sale(uuidv7(), "cash", "1200000"))).toEqual(["applied"]);
    expect(await statuses(a, m("sales.recordPayment", { id: uuidv7(), buyerId: ids.buyer, day: "2026-03-12", amountCentimes: "1200001", method: "cash" }))).toEqual(["errors.PAID_MORE_THAN_BALANCE"]);
    const buyer = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "buyer").at(-1)?.data;
    expect(buyer).toMatchObject({ id: ids.buyer, creditBlocked: true });
  });

  it("lets only the owner lift the block", async () => {
    const unblock = m("sales.unblockBuyer", { buyerId: ids.buyer });
    expect(await statuses({ ...a, role: "manager" }, unblock)).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, m("sales.unblockBuyer", { buyerId: ids.buyer }))).toEqual(["applied"]);
    expect(await statuses(a, sale(uuidv7(), "credit", "0"))).toEqual(["applied"]);
  });

  it("posts a later cheque cashed: D 5141 / C 51111", async () => {
    expect(await statuses(a, m("sales.recordPayment", { id: ids.payment, buyerId: ids.buyer, day: "2026-03-12", amountCentimes: "300000", method: "cheque" }))).toEqual(["applied"]);
    const cashed = step(ids.payment, "cashed", "2026-03-14");
    expect(await statuses(a, cashed)).toEqual(["applied"]);
    await postPending(a);
    expect(await linesOf(ids.payment)).toEqual([["3421", 0n, 300_000n], ["51111", 300_000n, 0n]]);
    expect(await linesOf(cashed.payload.id)).toEqual([["51111", 0n, 300_000n], ["5141", 300_000n, 0n]]);
  });

  it("keeps another organisation's instruments out of reach", async () => {
    expect(await statuses(b, step(ids.payment, "unpaid"))).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(b, m("sales.unblockBuyer", { buyerId: ids.buyer }))).toEqual(["errors.NOT_FOUND"]);
  });
});
