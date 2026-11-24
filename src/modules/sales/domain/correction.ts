import { fail, ok, type Result } from "@/lib/kernel/result";
import { checkEggSale, checkHeadSale, checkSale, eggLineAmount, type PaymentMethod, type SaleError } from "@/modules/sales/domain/sale";

// SPEC-finance §9 "Cancelled records": a sale's prices corrected after it was recorded. Pure: the phone shows the new
// amount with the same code the server applies. Its own file: /batches must not ship it (the batch screen's budget).

type Stored = {
  kind?: "live" | "eggs" | "perHead";
  birds: number;
  farmWeightGrams: number;
  buyerWeightGrams: number | null;
  paymentMethod?: PaymentMethod | "none";
  paidCentimes?: string;
  instrument?: { number: string; dueOn: string } | null;
  lines?: { item: string; eggs: number; eggsPerTray: number }[];
};
export type Prices = { pricePerKgCentimes: bigint | null; linePrices: readonly bigint[]; vatCentimes: bigint };

/**
 * The sale with new prices (per kg for live birds; per line, in order, by the head or per tray) and VAT; quantities,
 * buyer, day and payment unchanged, checked as when it was recorded (V2, V6, V7) but for the withdrawal, which its
 * day already passed. Returns the new amount, price per kg and lines (money as strings, as stored).
 */
export function repriceSale(s: Stored, p: Prices): Result<{ amountCentimes: bigint; pricePerKgCentimes: bigint; lines: { item: string; eggs: number; eggsPerTray: number; unitPriceCentimes: string; amountCentimes: string }[] }, SaleError> {
  const lines = s.lines ?? [];
  const kind = s.kind ?? "live";
  if (kind === "live" ? p.pricePerKgCentimes === null || p.linePrices.length > 0 : p.pricePerKgCentimes !== null || p.linePrices.length !== lines.length) return fail("INVALID_INPUT");
  const pay = { paymentMethod: (s.paymentMethod === "none" ? "cash" : (s.paymentMethod ?? "cash")) as PaymentMethod, paidCentimes: BigInt(s.paidCentimes ?? "0"), vatCentimes: p.vatCentimes, instrument: s.instrument ?? null };
  const priced = lines.map((l, n) => ({ ...l, unitPriceCentimes: p.linePrices[n] }));
  const checked =
    kind === "live" ? checkSale({ ...s, ...pay, pricePerKgCentimes: p.pricePerKgCentimes! }, null)
    : kind === "eggs" ? checkEggSale({ ...pay, lines: priced })
    : checkHeadSale({ ...pay, farmWeightGrams: s.farmWeightGrams || null, lines: priced.map((l) => ({ item: l.item as "bird", birds: l.eggs, pricePerHeadCentimes: l.unitPriceCentimes })) }, null);
  if (!checked.ok) return checked;
  const amountOf = (l: (typeof priced)[number]) => (kind === "eggs" ? eggLineAmount(l) : BigInt(l.eggs) * l.unitPriceCentimes);
  return ok({
    amountCentimes: checked.value.amountCentimes,
    pricePerKgCentimes: p.pricePerKgCentimes ?? 0n,
    lines: priced.map((l) => ({ item: l.item, eggs: l.eggs, eggsPerTray: l.eggsPerTray, unitPriceCentimes: String(l.unitPriceCentimes), amountCentimes: String(amountOf(l)) })),
  });
}
