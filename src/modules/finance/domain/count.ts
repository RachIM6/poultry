import type { FarmDay } from "@/lib/kernel/farm-day";
import { fiscalYearOf } from "@/modules/finance/domain/entry";
import { parseQuantity, type ItemKind, type Unit } from "@/modules/inventory/shared";

// SPEC-finance FC3: the year-end count. Quantities only, never an amount: the sheet goes to whoever counts.

/** The count day of the fiscal year that ends in calendar year `year`: its last day (ADR-010 §1). */
export function countDay(year: number, startMonth: number): FarmDay {
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  return fiscalYearOf(`${year}-${String(endMonth).padStart(2, "0")}-01` as FarmDay, startMonth).to;
}

/** The calendar year the fiscal year holding `day` ends in: the count's default year. */
export const countYearOf = (day: FarmDay, startMonth: number) => Number(fiscalYearOf(day, startMonth).to.slice(0, 4));

type BatchIn = { id: string; farmId: string; houseId: string; houseName: string; species: string; placedOn: string; closedOn: string | null; started: number; out: readonly { day: string; birds: number }[] };
type ItemIn = { id: string; farmId: string; kind: ItemKind; name: string; unit: Unit; lot: string | null; expiresOn: string | null; onHand: number };
type Counted = { book: number; counted: number | null; gap: number | null }; // gap = counted − book, once counted

export type CountBatchLine = { kind: "batch"; id: string; farmId: string; houseId: string; houseName: string; species: string } & Counted;
export type CountStockLine = { kind: "stock"; id: string; farmId: string; itemKind: ItemKind; name: string; unit: Unit; lot: string | null; expiresOn: string | null; expired: boolean } & Counted;
/** The farm's egg stock (SPEC-m3 E2), all items together; its `id` is the farm's. */
export type CountEggsLine = { kind: "eggs"; id: string; farmId: string } & Counted;
export type CountLine = CountBatchLine | CountStockLine | CountEggsLine;

/**
 * The sheet's lines on the count day: each batch open at the end of that day with its birds on hand (birds started −
 * dead, culled and sold up to that day), then each stock item with its book quantity, then each farm's eggs (T113);
 * with what was counted and the gap.
 */
export function countLines(day: FarmDay, batches: readonly BatchIn[], items: readonly ItemIn[], counted: ReadonlyMap<string, number>, eggs: readonly { farmId: string; eggs: number }[] = []): CountLine[] {
  const with_ = (id: string, book: number): Counted => {
    const c = counted.get(id);
    return { book, counted: c ?? null, gap: c === undefined ? null : c - book };
  };
  const open = batches.filter((b) => b.placedOn <= day && (b.closedOn === null || b.closedOn > day)); // ISO days sort as text
  return [
    ...open.map((b): CountBatchLine => ({
      kind: "batch",
      id: b.id,
      farmId: b.farmId,
      houseId: b.houseId,
      houseName: b.houseName,
      species: b.species,
      ...with_(b.id, b.started - b.out.filter((o) => o.day <= day).reduce((n, o) => n + o.birds, 0)),
    })),
    ...items.map((i): CountStockLine => ({
      kind: "stock",
      id: i.id,
      farmId: i.farmId,
      itemKind: i.kind,
      name: i.name,
      unit: i.unit,
      lot: i.lot,
      expiresOn: i.expiresOn,
      expired: i.expiresOn !== null && i.expiresOn < day,
      ...with_(i.id, i.onHand),
    })),
    ...eggs.map((e): CountEggsLine => ({ kind: "eggs", id: e.farmId, farmId: e.farmId, ...with_(e.farmId, e.eggs) })),
  ];
}

const MAX = 2_147_483_647; // the column is a 4-byte integer

/** A quantity counted, typed in the line's unit ("1 250,5" kg → 1 250 500 g; birds and eggs whole). 0 is a count. Null otherwise. */
export function parseCounted(text: string, line: CountLine): number | null {
  if (/^0+(?:[.,]0*)?$/.test(text.replace(/[\s  ]/g, ""))) return 0;
  const n = parseQuantity(text, line.kind === "stock" ? line.unit : "unit");
  return n !== null && n <= MAX ? n : null;
}
