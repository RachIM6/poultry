import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "./route";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { batchResultDtos, batchResults, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import type { BatchDto } from "@/modules/flock/schema";
import { requestCode, verifyCode } from "@/modules/identity";
import { buildBatchReport } from "@/modules/reporting/shared";
import { tenant } from "@/test/tenant";

// SPEC-finance §9 "One cost per kg": a closed batch shows one cost per kg, FN13's, on /results, the batch report and
// its comparison, the closing card and /compare (both read this route), never B6's narrower figure locked at closing.
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });
const origin = process.env.APP_ORIGIN!;

describe("one cost per kg for a closed batch (SPEC-finance FN13, §9)", () => {
  let a: TenantContext;
  let cookie: string;
  const ids = { farm: uuidv7(), house: uuidv7(), batch: uuidv7(), supplier: uuidv7(), feed: uuidv7(), buyer: uuidv7() };
  const expense = (amount: string, category: string, batchId: string | null, serviceMonth: string | null) =>
    m("finance.recordExpense", { id: uuidv7(), day: "2026-11-05", category, amountCentimes: amount, paidFrom: "credit", treasuryId: null, note: null, batchId, serviceMonth });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    a = await tenant("+212670000011");
    const pushed = await push(
      a,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
        m("sales.createBuyer", { id: ids.buyer, name: "Hamid", phone: null, type: "trader" }),
        m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: "2026-10-01", quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null }),
        // 1 000 chicks at 4,50 DH = 4 500 DH; 100 kg of feed at 4,50 DH = 450 DH
        m("flock.placeBatch", { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2026-10-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null }),
        m("flock.recordDay", { batchId: ids.batch, day: "2026-10-02", changes: { dead: 0, culled: 0, feed: { stockItemId: ids.feed, grams: 100_000 } } }),
        expense("20000", "vet_fees", ids.batch, null), // a direct charge of the batch: 200 DH
        expense("300000", "electricity", null, "2026-10"), // October's power, shared: the only batch present takes 3 000 DH
        // the last birds sold: 2 000 kg, the batch closes
        m("sales.recordSale", { id: uuidv7(), batchId: ids.batch, buyerId: ids.buyer, day: "2026-11-05", birds: 1000, farmWeightGrams: 2_000_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "3000000", instrument: null }),
      ],
      registry,
    );
    expect(pushed.results.map((r) => r.status)).toEqual(Array(11).fill("applied"));
    await postPending(a); // freezes the closed batch's shares
    await requestCode("0670000011", {});
    const code = (await db.verification.findFirstOrThrow({ where: { identifier: "phone-number-otp-+212670000011" } })).value.split(":")[0];
    const res = await verifyCode("0670000011", code, "fr", {});
    if (!res.ok) throw new Error(res.error);
    cookie = res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  });

  it("shows FN13's figure on /results, the report, the closing card and /compare, not B6's", async () => {
    // /results and the home: FN13. 4 500 + 450 + 200 direct + 3 000 shared = 8 150 DH over 2 000 kg = 4,075 → 4,08 DH/kg.
    const results = await batchResults(a);
    if (!results.ok) throw new Error(results.error);
    const row = results.value.find((r) => r.id === ids.batch)!;
    expect(row).toMatchObject({ frozen: true, costs: { chicks: 450_000n, consumption: 45_000n, other: 0n, direct: 20_000n, allocated: 300_000n }, costCentimes: 815_000n, costPerKgCentimes: 408n });

    // B6's figure is still locked on the batch (4 950 DH → 2,48 DH/kg), but no screen reads it.
    const batch = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "batch" && c.id === ids.batch).at(-1)?.data as BatchDto;
    expect(batch).toMatchObject({ status: "closed", costCentimes: "495000", costPerKgCentimes: "248" });

    // The closing card and /compare: this route's rows.
    const res = await GET(new Request(`${origin}/api/finance/batch-results`, { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const dtos = await res.json();
    expect(dtos.find((r: { id: string }) => r.id === ids.batch)).toMatchObject({ costCentimes: "815000", costPerKgCentimes: "408" });

    // The batch report and its comparison (RP3): the same rows, given by its page.
    const page = await batchResultDtos(a);
    expect(page).toEqual({ ok: true, value: dtos });
    const report = buildBatchReport({ batch, today: "2026-11-24" as FarmDay, batches: [batch], entries: [], weighings: [], sold: [], vaccinations: [], treatments: [], results: dtos, standardAt: null });
    expect(report.money?.costPerKgCentimes).toBe("408");
    expect(report.comparison.map((c) => c.costPerKgCentimes)).toEqual(["408"]);
  });

  it("gives a worker no money, and a signed-out request nothing", async () => {
    expect(await batchResultDtos({ ...a, role: "worker" })).toEqual({ ok: false, error: "FORBIDDEN" }); // the route answers 403
    expect((await GET(new Request(`${origin}/api/finance/batch-results`))).status).toBe(401);
  });
});
