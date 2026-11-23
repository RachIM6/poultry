import type { Line } from "@/modules/finance/domain/entry";
import type { Posting } from "@/modules/finance/domain/posting";
import type { ItemKind, Unit } from "@/modules/inventory/shared";

// SPEC-finance FC5 (T108): bought stock at the close, counted (else book) quantity × the weighted average cost on the
// fiscal year's last day (S5), and a provision where the owner typed a lower current value (FQ20).

/**
 * §5 "Bought stock by kind", with the PCA: the stock account follows the purchase's family (FN6, `CHARGE_BY_ITEM` in
 * posting.ts) and the variation is the matching 6124 leaf, never 6124 itself (FN4). With the PCA off, 612412 lands on
 * 61241 (FN2). Inventory has no packaging kind, so no 3123 leaf is used (FQ26).
 */
export const STOCK_ACCOUNTS: Record<ItemKind, { stock: string; variation: string }> = {
  feed: { stock: "3121", variation: "612412" }, // Matières premières / … Agricoles – Animaux
  vaccine: { stock: "3121", variation: "612412" },
  medicine: { stock: "3121", variation: "612412" },
  litter: { stock: "31221", variation: "61242" }, // Matières consommables
  other: { stock: "31221", variation: "61242" },
  gas: { stock: "31223", variation: "61242" }, // Combustibles
};
/**
 * The accounts of a kind in the entity's chart. Without the PCA a vaccine or a medicine is bought on 6122 (612123's
 * fallback, FN2), so its stock follows that family: 31221 / 61242, as litter.
 */
export const stockAccountsOf = (kind: ItemKind, pca: boolean) => (!pca && (kind === "vaccine" || kind === "medicine") ? STOCK_ACCOUNTS.litter : STOCK_ACCOUNTS[kind]);

export const PROVISION_CHARGE = "6196"; // Dotations d’exploitation aux provisions pour dépréciations de l’actif circulant
export const STOCK_PROVISION = "3912"; // Provisions pour dépréciation des matières et fournitures
export const PROVISION_REVERSAL = "7196"; // Reprises sur provisions pour dépréciation de l’actif circulant

/** §7 `stockAtCloseValue`: min(cost, current value), the provision the difference. No current value: at cost (FQ20). */
export function stockAtCloseValue(cost: bigint, current: bigint | null): { value: bigint; provision: bigint } {
  const value = current !== null && current < cost ? current : cost;
  return { value, provision: cost - value };
}

type ItemIn = { id: string; farmId: string; kind: ItemKind; name: string; unit: Unit; lot: string | null; onHand: number };

/** A stock line at the close. `cost` null: not valued (nothing left, or no purchase cost to value it at). */
export type StockAtClose = ItemIn & { quantity: number; cost: bigint | null; current: bigint | null; value: bigint; provision: bigint };

/**
 * Each item on the count day: the quantity counted (FC3), else the book one, × the item's average cost that day (its
 * value ÷ its book quantity), half up to the centime; with the owner's current value, if any.
 */
export function stocksAtClose(items: readonly ItemIn[], values: ReadonlyMap<string, bigint>, counted: ReadonlyMap<string, number>, current: ReadonlyMap<string, bigint>): StockAtClose[] {
  return items.map((i) => {
    const quantity = counted.get(i.id) ?? i.onHand;
    const worth = values.get(i.id) ?? 0n;
    const cost = quantity > 0 && i.onHand > 0 && worth > 0n ? (worth * BigInt(quantity) * 2n + BigInt(i.onHand)) / (2n * BigInt(i.onHand)) : null;
    const typed = current.get(i.id) ?? null;
    return { ...i, quantity, cost, current: typed, ...(cost === null ? { value: 0n, provision: 0n } : stockAtCloseValue(cost, typed)) };
  });
}

const sum = (into: Map<string, bigint>, account: string, amount: bigint) => into.set(account, (into.get(account) ?? 0n) + amount);
const sorted = (m: Map<string, bigint>) => [...m].filter(([, a]) => a > 0n).sort(([a], [b]) => a.localeCompare(b));

// SPEC-finance FC5 (T113): eggs in stock, the counted (else book) quantity × the value per egg the owner types (FQ18:
// no computed cost), in the "stock" entry.
export const EGGS_STOCK = "3152"; // Produits finis (d’animaux)
export const EGGS_VARIATION = "7132"; // Variation des stocks de biens produits

/**
 * A farm's eggs at the close. `perEgg`: the owner's value of one egg, in centimes. `posted` false: the PCA is off, so 3152
 * lands on 315, which has sub-accounts: nothing posts until the accountant names a CGNC account (FQ25, FN4).
 * `missing`: eggs to post without a value, so the run refuses to post.
 */
export type EggsAtClose = { farmId: string; book: number; quantity: number; perEgg: bigint | null; value: bigint; posted: boolean; missing: boolean };

export function eggsAtClose(stock: readonly { farmId: string; eggs: number }[], counted: ReadonlyMap<string, number>, perEgg: ReadonlyMap<string, bigint>, pca: boolean): EggsAtClose[] {
  return stock.map(({ farmId, eggs }) => {
    const quantity = counted.get(farmId) ?? eggs;
    const value = perEgg.get(farmId) ?? null;
    return { farmId, book: eggs, quantity, perEgg: value, value: pca && value !== null ? BigInt(quantity) * value : 0n, posted: pca, missing: pca && quantity > 0 && value === null };
  });
}

/**
 * FC5: D each stock account / C each 6124 leaf, at cost; `pca`: the entity's chart has the overlay. With it, the eggs:
 * D 3152 / C 7132 (T113). Null when nothing is valued.
 */
export function yearEndStock(lines: readonly StockAtClose[], pca: boolean, eggs: readonly EggsAtClose[] = []): Posting | null {
  const debits = new Map<string, bigint>();
  const credits = new Map<string, bigint>();
  for (const l of lines) {
    if (!l.cost) continue;
    const { stock, variation } = stockAccountsOf(l.kind, pca);
    sum(debits, stock, l.cost);
    sum(credits, variation, l.cost);
  }
  for (const e of eggs) {
    sum(debits, EGGS_STOCK, e.value);
    sum(credits, EGGS_VARIATION, e.value);
  }
  const out: Line[] = [...sorted(debits).map(([account, debit]) => ({ account, debit, credit: 0n })), ...sorted(credits).map(([account, credit]) => ({ account, debit: 0n, credit }))];
  return out.length ? { journal: "OD", label: "Stocks de fin d’exercice", lines: out } : null;
}

/**
 * FC4, FC5: one provision entry for the stock lines and the batches in progress whose current value is below cost,
 * D 6196 / C 3912 and C 3913. Null when there is none.
 */
export function yearEndProvision(lines: readonly StockAtClose[], batches: readonly BatchAtClose[] = []): Posting | null {
  const stock = lines.reduce((s, l) => s + l.provision, 0n);
  const inProgress = batches.reduce((s, b) => s + b.provision, 0n);
  if (stock + inProgress === 0n) return null;
  const credits = [[STOCK_PROVISION, stock], [IN_PROGRESS_PROVISION, inProgress]] as const;
  return {
    journal: "OD",
    label: "Provisions pour dépréciation de l’actif circulant",
    lines: [{ account: PROVISION_CHARGE, debit: stock + inProgress, credit: 0n }, ...credits.filter(([, a]) => a > 0n).map(([account, credit]) => ({ account, debit: 0n, credit }))],
  };
}

// SPEC-finance FC4 (T109): meat batches still open on the fiscal year's last day, at FN13's cost engaged to that day,
// split by head (FQ19), against a current value from the last weighing and the last sale price (FQ20).

export const IN_PROGRESS = "31322"; // Animaux (3132 Encours de Production); 3132 with the PCA off
export const IN_PROGRESS_VARIATION = "7131"; // Variation des stocks de produits en cours
export const IN_PROGRESS_PROVISION = "3913"; // Provisions pour dépréciation des produits en cours

/** FC4's scope: the types sold as meat. Pullets and layers are FC6, not valued until FQ7 (T114, T115). */
export const MEAT_TYPES: readonly string[] = ["broiler", "turkey", "beldi", "duck", "quail"];

const half = (a: bigint, b: bigint) => (a * 2n + b) / (2n * b); // a ÷ b half up, a ≥ 0, b > 0

/**
 * §7 `batchInProgressValue`: cost engaged × on hand ÷ (on hand + sold), half up (the dead are carried by the
 * survivors); the provision is cost − current value when positive. No current value: at cost.
 */
export function batchInProgressValue(engaged: bigint, onHand: number, sold: number, current: bigint | null): { cost: bigint; provision: bigint } {
  const cost = onHand > 0 && engaged > 0n ? half(engaged * BigInt(onHand), BigInt(onHand + sold)) : 0n;
  return { cost, provision: stockAtCloseValue(cost, current).provision };
}

type Weighing = { count: number; totalGrams: number };
type Sale = { kind: "live" | "perHead"; pricePerKgCentimes: bigint; amountCentimes: bigint; birds: number };

/**
 * FQ20's default current value: birds on hand × the last average weighing × the last price per kg, or × the last
 * price per head for a sale by the head; half up once. Null without a sale, or a sale by the kg without a weighing.
 */
export function suggestedValue(onHand: number, weighing: Weighing | null, sale: Sale | null): bigint | null {
  if (!sale) return null;
  if (sale.kind === "perHead") return sale.birds > 0 ? half(BigInt(onHand) * sale.amountCentimes, BigInt(sale.birds)) : null;
  if (!weighing || weighing.count <= 0) return null;
  return half(BigInt(onHand) * BigInt(weighing.totalGrams) * sale.pricePerKgCentimes, BigInt(weighing.count) * 1000n);
}

type BatchIn = { id: string; farmId: string; houseName: string; species: string; onHand: number; sold: number; engaged: bigint };

/**
 * A batch open on the last day. `valued` false: a pullet or layer batch, listed "non valorisés (FQ7)". `current`: the
 * owner's value, else the suggested one; `missing`: valued at a cost with neither, so the run refuses to post.
 */
export type BatchAtClose = BatchIn & { valued: boolean; cost: bigint; suggested: bigint | null; typed: bigint | null; current: bigint | null; provision: bigint; missing: boolean };

export function batchesAtClose(batches: readonly BatchIn[], weighings: ReadonlyMap<string, Weighing>, sales: ReadonlyMap<string, Sale>, typed: ReadonlyMap<string, bigint>): BatchAtClose[] {
  return batches.map((b) => {
    const valued = MEAT_TYPES.includes(b.species);
    const suggested = valued ? suggestedValue(b.onHand, weighings.get(b.id) ?? null, sales.get(`${b.farmId}:${b.species}`) ?? null) : null;
    const own = valued ? (typed.get(b.id) ?? null) : null;
    const current = own ?? suggested;
    const { cost, provision } = valued ? batchInProgressValue(b.engaged, b.onHand, b.sold, current) : { cost: 0n, provision: 0n };
    return { ...b, valued, cost, suggested, typed: own, current, provision, missing: cost > 0n && current === null };
  });
}

/** FC4: D 31322 / C 7131 at cost for the batches valued. Null when nothing is. */
export function yearEndBatches(batches: readonly BatchAtClose[]): Posting | null {
  const total = batches.reduce((s, b) => s + b.cost, 0n);
  if (total === 0n) return null;
  return { journal: "OD", label: "Encours de production : animaux", lines: [{ account: IN_PROGRESS, debit: total, credit: 0n }, { account: IN_PROGRESS_VARIATION, debit: 0n, credit: total }] };
}
