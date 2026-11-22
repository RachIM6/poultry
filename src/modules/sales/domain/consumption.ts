// SPEC-finance FC7: birds or eggs taken home by the exploitant, an associate or an employee instead of being sold. Pure:
// the phone prefills the price with the same rule the server applies to a worker's entry, which carries none (I5).

export const TAKERS = ["exploitant", "associate", "employee"] as const;
export type Taker = (typeof TAKERS)[number];

type PricedSale = { id: string; day: string; kind?: "live" | "eggs" | "perHead"; takenBy?: Taker | null; pricePerKgCentimes?: string; lines?: { item: string; unitPriceCentimes: string }[] };

/**
 * FQ21's default: each product's price at the farm's last sale of it on or before `day`, consumptions aside. Live birds
 * per kg (key "kg"), per head by kind, eggs per tray by item. A product never sold has no price (its value is then 0).
 */
export function lastPrices(sales: readonly PricedSale[], kind: "live" | "eggs" | "perHead", day: string): Map<string, bigint> {
  const prices = new Map<string, bigint>();
  const sold = sales.filter((s) => (s.kind ?? "live") === kind && !s.takenBy && s.day <= day).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  for (const s of sold) {
    if (kind === "live" && s.pricePerKgCentimes) prices.set("kg", BigInt(s.pricePerKgCentimes));
    for (const l of s.lines ?? []) prices.set(l.item, BigInt(l.unitPriceCentimes));
  }
  return prices;
}

/** A price as the forms' inputs take it ("14,50"), empty when there is none. */
export const typedPrice = (c: bigint | undefined) => (c === undefined ? "" : `${c / 100n},${String(c % 100n).padStart(2, "0")}`);
