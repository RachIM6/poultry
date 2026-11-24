import { formatDecimal, formatDay, formatKg, formatMoney } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { LocalRecord } from "./db";

// ADR-003 §7: a refused write says what it was, where it belongs and what was typed, so it can be redone. Its label is
// `Sync.types.<type>` in messages; the screen is the module's, unless the type is written from another one.
const BY_MODULE: Record<string, string> = {
  "farm-registry": "/farms",
  "reference-data": "/protocol",
  notifications: "/inbox",
  inventory: "/stock",
  flock: "/batches",
  eggs: "/batches",
  health: "/batches",
  sales: "/batches",
  finance: "/expenses",
  workforce: "/staff",
  climate: "/climate",
  "market-prices": "/prices",
  planning: "/planning",
  biosecurity: "/disposal",
  documents: "/documents",
};
const BY_TYPE: Record<string, string> = {
  "eggs.gradeEggs": "/eggs",
  "eggs.discardEggs": "/eggs",
  "sales.recordEggSale": "/eggs",
  "sales.recordPayment": "/receivables",
  "sales.setInstrumentState": "/receivables",
  "sales.unblockBuyer": "/receivables",
  "sales.setCreditLimit": "/receivables",
  "sales.approveCredit": "/receivables",
  "finance.recordTransfer": "/treasury",
  "workforce.saveRoutine": "/tasks",
  "workforce.addTask": "/tasks",
  "workforce.cancelTask": "/tasks",
  "workforce.assignTask": "/tasks",
  "workforce.tickTask": "/tasks",
  "workforce.untickTask": "/tasks",
  "workforce.checkIn": "/tasks",
  "climate.saveTargets": "/climate/targets",
  "biosecurity.recordVisit": "/visitors",
  "biosecurity.editVisit": "/visitors",
  "biosecurity.startCleanout": "/cleanout",
  "biosecurity.recordCleanoutStep": "/cleanout",
  "biosecurity.editCleanoutStep": "/cleanout",
};

type Value = string | number | boolean;
type Leaf = [path: string, value: Value | Value[]];

/** The payload's filled-in values, nested ones as `a.b`, in order; a list of plain values (weights) stays one. */
function leaves(value: unknown, path = ""): Leaf[] {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return [];
  if (typeof value !== "object" || (Array.isArray(value) && value.every((v) => typeof v !== "object"))) return [[path, value as Leaf[1]]];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}
const last = (path: string) => path.slice(path.lastIndexOf(".") + 1);
const isId = (path: string) => path.split(".").some((s) => /^id$|Ids?$/.test(s));
const isDay = (path: string, v: Leaf[1]) => /^(day|on|\w+On)$/.test(last(path)) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Where the write can be typed again: its screen, and the batch's own day for a batch write. Undefined if unknown. */
export function redoHref(type: string, payload: unknown): string | undefined {
  const fields = leaves(payload);
  const batchId = fields.find(([p]) => last(p) === "batchId")?.[1];
  const eggs = type === "sales.recordConsumption" && fields.some(([p, v]) => p === "kind" && v === "eggs");
  const route = eggs ? "/eggs" : (BY_TYPE[type] ?? BY_MODULE[type.slice(0, type.indexOf("."))]);
  return route === "/batches" && typeof batchId === "string" ? `/batches#${batchId}` : route;
}

/** The house (or farm) and the day the write was about, from the phone's own records. */
export function refusalContext(payload: unknown, records: Pick<LocalRecord, "key" | "data">[]): { place?: string; day?: string } {
  const fields = leaves(payload);
  const id = (key: string) => fields.find(([p]) => last(p) === key)?.[1];
  const data = (entity: string, key: unknown) => records.find((r) => r.key === `${entity}:${key}`)?.data as { name?: string; houseId?: string } | undefined;
  const house = data("house", id("houseId") ?? data("batch", id("batchId"))?.houseId)?.name;
  const day = fields.find(([p, v]) => isDay(p, v))?.[1] as string | undefined;
  return { place: house ?? data("farm", id("farmId"))?.name, day };
}

// A field's label on the forms, and how its value reads; an id reads as the name of its record on this phone.
type As = "kg" | "dh" | "l" | "day" | "cause" | `name:${string}`;
const FIELDS: Record<string, [label: string, as?: As]> = {
  dead: ["Day.dead"],
  culled: ["Day.culled"],
  deathCause: ["Day.cause", "cause"],
  feed: ["Day.feed", "kg"],
  waterMl: ["Expenses.categories.water", "l"],
  note: ["VetVisit.notes"],
  notes: ["VetVisit.notes"],
  day: ["Day.day", "day"],
  birds: ["Sale.birds"],
  count: ["Weighing.count"],
  eggs: ["Count.eggs"],
  quantity: ["Close.quantity"],
  weightsGrams: ["Compare.cols.weight", "kg"],
  totalGrams: ["Compare.cols.weight", "kg"],
  farmWeightGrams: ["Origin.weight", "kg"],
  amountCentimes: ["Bank.amount", "dh"],
  pricePerKgCentimes: ["Sale.price", "dh"],
  pricePerHeadCentimes: ["Sale.pricing", "dh"],
  unitPriceCentimes: ["Sale.pricing", "dh"],
  priceCentimes: ["Sale.pricing", "dh"],
  buyerId: ["Sale.buyer", "name:buyer"],
  houseId: ["Batches.house", "name:house"],
  stockItemId: ["Stock.item", "name:stockItem"],
  supplierId: ["Stock.supplier", "name:supplier"],
};
// Unlisted fields keep their own name; their unit still shows when the name says it.
const bySuffix = (name: string): As | undefined => (/Grams$/.test(name) ? "kg" : /Centimes$/.test(name) ? "dh" : /^(on|\w+On)$/.test(name) ? "day" : undefined);

type T = (key: string, values?: Record<string, string>) => string;
type Named = Pick<LocalRecord, "key" | "data">;

/**
 * What was typed, as "label : value" in the form's words and units, enough to type it again. Ids without a record on
 * this phone are left out; long values (a file) are cut.
 */
export function payloadSummary(payload: unknown, records: Named[], t: T, locale: string): string[] {
  return leaves(payload).flatMap(([path, raw]) => {
    const parts = path.split(".").filter((s) => !/^\d+$/.test(s));
    const name = parts.at(-1) === "grams" && parts.length > 1 ? parts.at(-2)! : (parts.at(-1) ?? "");
    const [label, as = bySuffix(name)] = FIELDS[name] ?? [];
    const one = (v: Value): string | undefined => {
      if (as === "kg" && typeof v === "number") return formatKg(v);
      if (as === "dh" && /^-?\d+$/.test(String(v))) return formatMoney(BigInt(v));
      if (as === "l" && typeof v === "number") return `${formatDecimal(v / 1000, 1)} L`;
      if (as === "day" && typeof v === "string") return formatDay(v as FarmDay, locale);
      if (as === "cause") return t(`Day.causes.${v}`);
      if (as?.startsWith("name:")) return (records.find((r) => r.key === `${as.slice(5)}:${v}`)?.data as { name?: string } | undefined)?.name;
      if (isId(path)) return undefined;
      return String(v).length > 40 ? `${String(v).slice(0, 40)}…` : String(v);
    };
    const values = (Array.isArray(raw) ? raw : [raw]).map(one);
    if (values.some((v) => v === undefined)) return [];
    return [t("Sync.value", { label: label ? t(label) : parts.join("."), value: values.join(", ") })];
  });
}
