// SPEC-m5 MP1, MP2. Pure and isomorphic: the phone shows the latest prices from its local records, offline.

/** Fixed units (MP1): chicks and cull hens by the head, feed and live broilers by the kg, eggs by the egg. */
export const PRODUCTS = ["chick", "feed", "liveBroiler", "egg", "cullHen"] as const;
export type Product = (typeof PRODUCTS)[number];
export const UNIT: Record<Product, "head" | "kg" | "egg"> = { chick: "head", feed: "kg", liveBroiler: "kg", egg: "egg", cullHen: "head" };

/** A price someone on the farm saw, per unit, in integer centimes (a string: JSON has no bigint). */
export type PriceDto = { id: string; product: Product; day: string; priceCentimes: string; seenOn: string | null; byUserId: string };

export type LatestPrice = { product: Product; latest: PriceDto; changeCentimes: bigint | null };

/** Per product in PRODUCTS order: the latest price (latest day, then the later UUIDv7) and the change from the previous. */
export function latestByProduct(prices: readonly PriceDto[]): LatestPrice[] {
  return PRODUCTS.flatMap((product) => {
    const [latest, previous] = prices.filter((x) => x.product === product).sort((a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id));
    return latest ? [{ product, latest, changeCentimes: previous ? BigInt(latest.priceCentimes) - BigInt(previous.priceCentimes) : null }] : [];
  });
}
