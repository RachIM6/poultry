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

/** FC5: D each stock account / C each 6124 leaf, at cost; `pca`: the entity's chart has the overlay. Null when nothing is valued. */
export function yearEndStock(lines: readonly StockAtClose[], pca: boolean): Posting | null {
  const debits = new Map<string, bigint>();
  const credits = new Map<string, bigint>();
  for (const l of lines) {
    if (!l.cost) continue;
    const { stock, variation } = stockAccountsOf(l.kind, pca);
    sum(debits, stock, l.cost);
    sum(credits, variation, l.cost);
  }
  const out: Line[] = [...sorted(debits).map(([account, debit]) => ({ account, debit, credit: 0n })), ...sorted(credits).map(([account, credit]) => ({ account, debit: 0n, credit }))];
  return out.length ? { journal: "OD", label: "Stocks de fin d’exercice", lines: out } : null;
}

/** FC5: the provision for the lines whose current value is below cost, D 6196 / C 3912. Null when there is none. */
export function yearEndProvision(lines: readonly StockAtClose[]): Posting | null {
  const total = lines.reduce((s, l) => s + l.provision, 0n);
  if (total === 0n) return null;
  return { journal: "OD", label: "Provisions pour dépréciation de l’actif circulant", lines: [{ account: PROVISION_CHARGE, debit: total, credit: 0n }, { account: STOCK_PROVISION, debit: 0n, credit: total }] };
}
