import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, postPending } from "@/modules/finance";
import { trialBalance } from "@/modules/finance/domain/books";
import { bankOnly, EXPENSE_CATEGORIES, PAID_FROM } from "@/modules/finance/domain/treasury";
import { pendingOrganizations } from "@/modules/finance/infrastructure/ledger";
import { AccountsFile } from "@/modules/finance/schema";
import { saleAmount } from "@/modules/sales/shared";
import { tenant } from "@/test/tenant";

// SPEC-finance §8 M2 criterion 1: seeded random sequences of real M1/M2 mutations, pushed as the owner, then posted.
// The journal stays balanced, nothing stays pending, and replaying the same sync changes nothing. On a failure, the seed
// and the pushed sequence are printed: `SEEDS = [n]` replays the run.

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

// The posting pipeline's sources (finance/application/posting.ts SOURCES): name and the change-log entity each reads.
const SOURCES = [
  { name: "inventory.purchase", entity: "purchase" },
  { name: "inventory.supplierPayment", entity: "supplierPayment" },
  { name: "inventory.issuedDebit", entity: "issuedDebit" },
  { name: "flock.placement", entity: "batch" },
  { name: "flock.transfer", entity: "batch" },
  { name: "sales.sale", entity: "sale" },
  { name: "sales.payment", entity: "buyerPayment" },
  { name: "sales.instrument", entity: "instrumentStatus" },
  { name: "workforce.advance", entity: "advance" },
  { name: "workforce.payPayment", entity: "payPayment" },
  { name: "workforce.payMonth", entity: "payMonth" },
];

const SUPPLIER_METHODS = ["cash", "transfer", "cheque", "bill"] as const;
const SALE_METHODS = ["cash", "cheque", "bill", "transfer", "credit"] as const;
const LATER_METHODS = ["cash", "cheque", "bill", "transfer"] as const;

const FIRST_DAY = Date.UTC(2026, 2, 2); // a month in the past, open
const dayAt = (t: number) => new Date(FIRST_DAY + t * 86_400_000).toISOString().slice(0, 10);
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-03-01T08:00:00+01:00" });

type Batch = { id: string; house: string; onHand: number; open: boolean };
type Instrument = { buyer: string; amount: bigint; state: "in_portfolio" | "remitted" | "cashed" | "unpaid" };
type Sale = { id: string; buyer: string; batch: Batch; birds: number; weight: number; amount: bigint; paid: bigint };
type Expense = Record<string, unknown> & { id: string; amountCentimes: string };

/** What the farm holds after the applied mutations: enough to generate valid ones. */
class Farm {
  t = 0;
  owedToSupplier = 0n;
  purchases: { id: string; credit: bigint }[] = [];
  issued: string[] = []; // supplier payments by cheque or bill, not debited yet
  batches: Batch[] = [];
  sales: Sale[] = [];
  owedBy = new Map<string, bigint>();
  blocked = new Set<string>();
  instruments = new Map<string, Instrument>();
  expenses: Expense[] = [];
  constructor(readonly ids: { farm: string; houses: string[]; supplier: string; feed: string; buyers: string[]; cash: string; bank: string }) {}
}

const lcg = (seed: number) => {
  let s = seed;
  const rand = (n: number) => ((s = (s * 1_103_515_245 + 12_345) % 2_147_483_648), s % n);
  return { rand, big: (n: bigint) => BigInt(rand(Number(n))), pick: <T,>(xs: readonly T[]) => xs[rand(xs.length)] };
};
type Rng = ReturnType<typeof lcg>;

// A generator gives the next mutation and what it changes once applied, or null when the farm has nothing for it.
type Step = { mutation: PushedMutation; applied: () => void };
type Generator = (r: Rng, f: Farm, day: string) => Step | null;

const purchase: Generator = (r, f, day) => {
  const kg = 1 + r.rand(3000);
  const amount = BigInt(kg * (300 + r.rand(300)));
  const paid = r.pick([0n, amount, r.big(amount + 1n)]);
  const id = uuidv7();
  const payload = {
    id, movementId: uuidv7(), supplierId: f.ids.supplier, stockItemId: f.ids.feed, day, quantity: kg * 1000, unitPriceCentimes: String(amount / BigInt(kg)),
    paidCentimes: String(paid), vatCentimes: String(r.rand(4) === 0 ? r.big(amount / 5n) : 0n), paidMethod: r.pick(SUPPLIER_METHODS), dueOn: null,
  };
  return { mutation: m("inventory.recordPurchase", payload), applied: () => ((f.owedToSupplier += amount - paid), f.purchases.push({ id, credit: amount - paid })) };
};

const placement: Generator = (r, f, day) => {
  const house = f.ids.houses.find((h) => !f.batches.some((b) => b.open && b.house === h));
  if (!house) return null;
  const [chicks, dead] = [1000 + r.rand(5000), r.rand(20)];
  const batch: Batch = { id: uuidv7(), house, onHand: chicks - dead, open: true };
  const payload = {
    id: batch.id, houseId: house, strainId: "ross-308", placedOn: day, chicksPlaced: chicks, deadOnArrival: dead, hatchery: "H", deliveryNote: "BL",
    chickUnitPriceCentimes: String(400 + r.rand(300)), chickVatCentimes: r.rand(3) === 0 ? String(r.rand(50_000)) : null, dayOldWeightGrams: null,
  };
  return { mutation: m("flock.placeBatch", payload), applied: () => f.batches.push(batch) };
};

const sale: Generator = (r, f, day) => {
  const batch = r.pick(f.batches.filter((b) => b.open));
  if (!batch) return null;
  const buyer = r.pick(f.ids.buyers);
  const birds = r.rand(10) === 0 ? batch.onHand : Math.min(batch.onHand, 1 + r.rand(400)); // now and then the last birds: the batch closes
  const weight = birds * (1800 + r.rand(800));
  const price = BigInt(1200 + r.rand(800));
  const amount = saleAmount(weight, price);
  const method = f.blocked.has(buyer) ? r.pick(LATER_METHODS) : r.pick(SALE_METHODS); // FN12: a blocked buyer pays at once
  const paid = method === "credit" ? 0n : f.blocked.has(buyer) ? amount : r.pick([amount, 1n + r.big(amount)]);
  const instrument = method === "cheque" || method === "bill" ? { number: `N${r.rand(1e6)}`, dueOn: day } : null;
  const s: Sale = { id: uuidv7(), buyer, batch, birds, weight, amount, paid };
  const payload = {
    id: s.id, batchId: batch.id, buyerId: buyer, day, birds, farmWeightGrams: weight, buyerWeightGrams: r.rand(2) ? null : weight - r.rand(weight),
    pricePerKgCentimes: String(price), paymentMethod: method, paidCentimes: String(paid), vatCentimes: String(r.rand(4) === 0 ? r.big(amount / 5n) : 0n), instrument,
  };
  return {
    mutation: m("sales.recordSale", payload),
    applied: () => {
      f.sales.push(s);
      f.owedBy.set(buyer, (f.owedBy.get(buyer) ?? 0n) + amount - paid);
      if (instrument) f.instruments.set(s.id, { buyer, amount: paid, state: "in_portfolio" });
      batch.onHand -= birds;
      batch.open = batch.onHand > 0;
    },
  };
};

const buyerPayment: Generator = (r, f, day) => {
  const buyer = r.pick(f.ids.buyers.filter((b) => (f.owedBy.get(b) ?? 0n) > 0n));
  if (!buyer) return null;
  const amount = 1n + r.big(f.owedBy.get(buyer)!);
  const method = r.pick(LATER_METHODS);
  const id = uuidv7();
  const instrument = method === "cheque" || method === "bill" ? { number: `P${r.rand(1e6)}`, dueOn: day } : null;
  return {
    mutation: m("sales.recordPayment", { id, buyerId: buyer, day, amountCentimes: String(amount), method, instrument }),
    applied: () => {
      f.owedBy.set(buyer, f.owedBy.get(buyer)! - amount);
      if (instrument) f.instruments.set(id, { buyer, amount, state: "in_portfolio" });
    },
  };
};

const instrumentMove: Generator = (r, f, day) => {
  const [id, i] = r.pick([...f.instruments].filter(([, i]) => i.state === "in_portfolio" || i.state === "remitted")) ?? [];
  if (!id || !i) return null;
  const state = r.pick(i.state === "in_portfolio" ? (["remitted", "cashed", "unpaid"] as const) : (["cashed", "unpaid"] as const));
  return {
    mutation: m("sales.setInstrumentState", { id: uuidv7(), instrumentId: id, state, day }),
    applied: () => {
      i.state = state;
      if (state !== "unpaid") return;
      f.owedBy.set(i.buyer, (f.owedBy.get(i.buyer) ?? 0n) + i.amount); // back on what the buyer owes, and credit blocked (FN12)
      f.blocked.add(i.buyer);
    },
  };
};

const supplierPayment: Generator = (r, f, day) => {
  if (f.owedToSupplier <= 0n) return null;
  const amount = 1n + r.big(f.owedToSupplier);
  const method = r.pick(SUPPLIER_METHODS);
  const id = uuidv7();
  const instrument = method === "cheque" || method === "bill" ? { number: `S${r.rand(1e6)}`, dueOn: day } : null;
  return {
    mutation: m("inventory.recordSupplierPayment", { id, supplierId: f.ids.supplier, day, amountCentimes: String(amount), method, instrument }),
    applied: () => ((f.owedToSupplier -= amount), instrument && f.issued.push(id)),
  };
};

const debitIssued: Generator = (r, f, day) => {
  const id = r.pick(f.issued);
  if (!id) return null;
  return { mutation: m("inventory.debitIssued", { id: uuidv7(), instrumentId: id, day }), applied: () => f.issued.splice(f.issued.indexOf(id), 1) };
};

const expenseFields = (r: Rng, f: Farm, day: string) => {
  const category = r.pick(EXPENSE_CATEGORIES);
  const paidFrom = bankOnly(category) ? "bank" : r.pick(PAID_FROM);
  const treasuryId = paidFrom === "bank" ? f.ids.bank : paidFrom === "cash" ? r.pick([f.ids.cash, null]) : null;
  const amount = 1n + r.big(500_000n);
  return { day, category, amountCentimes: String(amount), vatCentimes: String(r.rand(4) === 0 ? r.big(amount / 5n) : 0n), paidFrom, treasuryId, note: null };
};

const expense: Generator = (r, f, day) => {
  const e: Expense = { id: uuidv7(), ...expenseFields(r, f, day) };
  return { mutation: m("finance.recordExpense", e), applied: () => f.expenses.push(e) };
};

const correctExpense: Generator = (r, f, day) => {
  const before = r.pick(f.expenses);
  if (!before) return null;
  const after: Expense = { ...expenseFields(r, f, day), id: before.id, day: before.day };
  return { mutation: m("finance.correctExpense", after), applied: () => f.expenses.splice(f.expenses.indexOf(before), 1, after) };
};

const cancelExpense: Generator = (r, f) => {
  const e = r.pick(f.expenses);
  if (!e) return null;
  return { mutation: m("finance.cancelExpense", { expenseId: e.id }), applied: () => f.expenses.splice(f.expenses.indexOf(e), 1) };
};

const transfer: Generator = (r, f, day) => {
  const [fromId, toId] = r.pick([[f.ids.cash, f.ids.bank], [f.ids.bank, f.ids.cash]]);
  return { mutation: m("finance.recordTransfer", { id: uuidv7(), day, amountCentimes: String(1n + r.big(1_000_000n)), fromId, toId }), applied: () => {} };
};

const cancelPurchase: Generator = (r, f) => {
  const p = r.pick(f.purchases.filter((p) => p.credit <= f.owedToSupplier)); // a purchase the later payments don't cover
  if (!p) return null;
  return { mutation: m("inventory.cancelPurchase", { purchaseId: p.id }), applied: () => ((f.owedToSupplier -= p.credit), f.purchases.splice(f.purchases.indexOf(p), 1)) };
};

const cancelSale: Generator = (r, f) => {
  const s = r.pick(f.sales.filter((s) => s.batch.open && (f.instruments.get(s.id)?.state ?? "in_portfolio") === "in_portfolio" && f.owedBy.get(s.buyer)! >= s.amount - s.paid));
  if (!s) return null;
  return {
    mutation: m("sales.cancelSale", { saleId: s.id }),
    applied: () => {
      f.owedBy.set(s.buyer, f.owedBy.get(s.buyer)! - (s.amount - s.paid));
      f.instruments.delete(s.id);
      s.batch.onHand += s.birds;
      f.sales.splice(f.sales.indexOf(s), 1);
    },
  };
};

const correctSale: Generator = (r, f) => {
  const s = r.pick(f.sales.filter((s) => !f.blocked.has(s.buyer)));
  if (!s) return null;
  const price = BigInt(1200 + r.rand(800));
  const amount = saleAmount(s.weight, price);
  if (amount < s.paid || f.owedBy.get(s.buyer)! + amount - s.amount < 0n) return null;
  return {
    mutation: m("sales.correctSale", { saleId: s.id, pricePerKgCentimes: String(price), linePrices: [], vatCentimes: "0" }),
    applied: () => (f.owedBy.set(s.buyer, f.owedBy.get(s.buyer)! + amount - s.amount), (s.amount = amount)),
  };
};

const correctPlacement: Generator = (r, f) => {
  const b = r.pick(f.batches.filter((b) => b.open));
  if (!b) return null;
  return { mutation: m("flock.correctPlacement", { batchId: b.id, changes: { chickUnitPriceCentimes: String(400 + r.rand(300)) } }), applied: () => {} };
};

// Weighted: the everyday writes come more often than the corrections.
const GENERATORS: Generator[] = [
  purchase, purchase, purchase, placement, sale, sale, sale, sale, buyerPayment, buyerPayment, instrumentMove, instrumentMove, supplierPayment, supplierPayment,
  debitIssued, expense, expense, correctExpense, cancelExpense, transfer, cancelPurchase, cancelSale, correctSale, correctPlacement,
];

/** The farm a run starts with: a farm, three houses (two with a batch), the feed and its supplier, two buyers, a cash box and a bank account. */
function setUp(r: Rng, f: Farm): Step[] {
  const { ids } = f;
  const plain = (type: string, payload: unknown): Step => ({ mutation: m(type, payload), applied: () => {} });
  return [
    plain("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
    ...ids.houses.map((id, i) => plain("farm-registry.createHouse", { id, farmId: ids.farm, name: `B${i + 1}`, areaM2: 1000, capacity: 10_000, type: "closed" })),
    plain("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
    plain("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
    ...ids.buyers.map((id, i) => plain("sales.createBuyer", { id, name: `Acheteur ${i + 1}`, phone: null, type: "trader" })),
    plain("finance.createTreasuryAccount", { id: ids.cash, kind: "cash", name: "Caisse" }),
    plain("finance.createTreasuryAccount", { id: ids.bank, kind: "bank", name: "Banque" }),
    placement(r, f, dayAt(0))!,
  ];
}

/** The organisation's journal: what a replay must leave identical. */
async function journalOf(organizationId: string) {
  const entries = await db.journalEntry.findMany({ where: { organizationId }, include: { lines: true } });
  const lines = entries.flatMap((e) => e.lines.map((l) => ({ account: l.account, debit: l.debitCentimes, credit: l.creditCentimes })));
  const unbalanced = entries.filter(
    (e) => e.lines.length < 2 || e.lines.some((l) => l.debitCentimes < 0n || l.creditCentimes < 0n || (l.debitCentimes > 0n) === (l.creditCentimes > 0n)) || e.lines.reduce((s, l) => s + l.debitCentimes - l.creditCentimes, 0n) !== 0n,
  );
  return {
    unbalanced: unbalanced.map((e) => `${e.label} (${e.sourceModule}:${e.sourceId})`),
    trialBalance: trialBalance(lines),
    count: entries.length,
    versions: entries.map((e) => `${e.sourceModule}:${e.sourceId}:${e.sourceVersion}:${e.reversesId ?? "-"}`).sort(),
  };
}

describe("posting pipeline property (SPEC-finance §8 M2 criterion 1)", () => {
  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
  }, 120_000);

  it.each(SEEDS)("seed %i: balanced books, nothing pending, a replayed sync changes nothing", async (seed) => {
    const r = lcg(seed);
    const ctx: TenantContext = await tenant(`+2126000${String(seed).padStart(5, "0")}`);
    // the entity's choices vary with the seed: the defaults, VAT-registered (FN9), PCA off (FN2)
    const [entity] = await listLegalEntities(ctx);
    if (seed % 3 === 1) await changeAccountingChoices(ctx, entity.id, { books: null, pcaOverlay: null, fiscalYearStartMonth: 1, vatRegistered: true });
    if (seed % 3 === 2) await changeAccountingChoices(ctx, entity.id, { books: null, pcaOverlay: false, fiscalYearStartMonth: 1 });

    const f = new Farm({ farm: uuidv7(), houses: [uuidv7(), uuidv7(), uuidv7()], supplier: uuidv7(), feed: uuidv7(), buyers: [uuidv7(), uuidv7()], cash: uuidv7(), bank: uuidv7() });
    const pushed: PushedMutation[] = [];
    const results: Awaited<ReturnType<typeof push>>["results"] = [];
    const send = async (step: Step) => {
      pushed.push(step.mutation);
      const [result] = (await push(ctx, [step.mutation], registry)).results;
      expect(result, `${step.mutation.type} threw (see the log)`).toBeDefined();
      results.push(result);
      if (result.status === "applied") step.applied();
    };
    try {
      for (const step of setUp(r, f)) await send(step);
      expect(results.every((x) => x.status === "applied")).toBe(true);
      const second = placement(r, f, dayAt(0)); // the second house's batch
      if (second) await send(second);

      for (let n = 20 + r.rand(21); n > 0; n--) {
        f.t += r.rand(2);
        let step: Step | null = null;
        while (!step) step = r.pick(GENERATORS)(r, f, dayAt(f.t));
        await send(step);
      }
      const refused = results.filter((x) => x.status === "rejected");
      console.info(`seed ${seed}: ${pushed.length} mutations, ${refused.length} refused`, refused.map((x) => x.status === "rejected" && x.messageKey));
      expect(refused.length).toBeLessThan(pushed.length / 4); // the generator keeps to valid writes

      expect(await postPending(ctx)).toBeGreaterThan(0);
      const posted = await journalOf(ctx.organizationId);
      expect(posted.unbalanced).toEqual([]);
      expect(posted.trialBalance.balanced).toBe(true);
      expect(await pendingOrganizations(db, SOURCES, 1, ctx.organizationId)).toEqual([]);

      // the same sync again, same mutation ids: the stored results, and the pipeline posts nothing
      expect((await push(ctx, pushed, registry)).results).toEqual(results);
      expect(await postPending(ctx)).toBe(0);
      expect(await journalOf(ctx.organizationId)).toEqual(posted);
      expect(await pendingOrganizations(db, SOURCES, 1, ctx.organizationId)).toEqual([]);
    } catch (error) {
      console.error(`pipeline property failed, seed ${seed}; pushed in order:\n${JSON.stringify(pushed.map((x, i) => ({ ...x, result: results[i] })), null, 1)}`);
      throw error;
    }
  }, 120_000);
});
