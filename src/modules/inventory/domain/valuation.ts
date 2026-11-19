// SPEC S5: weighted average cost per item (an item is already per farm), as a running valuation over the ledger.
// Pure and exact: values are integer centimes; each outgoing movement takes its share of the current value, rounded
// half up, and that share leaves the stock. So costs taken + value left = what was paid, to the centime.

export type ValuedMovement = {
  id: string;
  day: string; // farm day
  quantity: number; // base units, signed
  purchaseAmountCentimes?: bigint; // for purchases: what was paid for this quantity
};

export type Valuation = {
  onHand: number;
  valueCentimes: bigint;
  /** What each outgoing movement cost (consumption, loss): what a batch is charged (T16, T24). */
  costs: Map<string, bigint>;
};

const share = (value: bigint, part: number, whole: number) => (value * BigInt(part) * 2n + BigInt(whole)) / (2n * BigInt(whole));

/** Movements in ledger order: by farm day, then by id (UUIDv7, so creation order within a day). */
export function valuate(movements: readonly ValuedMovement[]): Valuation {
  const ordered = [...movements].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  let onHand = 0;
  let value = 0n;
  const costs = new Map<string, bigint>();
  for (const m of ordered) {
    if (m.purchaseAmountCentimes !== undefined) {
      value += m.purchaseAmountCentimes;
    } else if (m.quantity > 0) {
      value += onHand > 0 ? share(value, m.quantity, onHand) : 0n; // found stock enters at the current average
    } else {
      // ponytail: stock already at or below zero (offline records crossing) gives the movement no cost.
      const cost = onHand > 0 ? share(value, Math.min(-m.quantity, onHand), onHand) : 0n;
      costs.set(m.id, cost);
      value -= cost;
    }
    onHand += m.quantity;
  }
  return { onHand, valueCentimes: onHand > 0 ? value : 0n, costs };
}
