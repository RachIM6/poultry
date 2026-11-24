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

type Leaf = [path: string, value: string | number | boolean];

/** The payload's filled-in values, nested ones as `a.b`, in order. */
function leaves(value: unknown, path = ""): Leaf[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value !== "object") return [[path, value as Leaf[1]]];
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

/** What was typed, as "field: value", without ids: enough to type it again. Long values (a file) are cut. */
export function payloadSummary(payload: unknown): string[] {
  return leaves(payload)
    .filter(([p]) => !isId(p))
    .map(([p, v]) => `${p}: ${String(v).length > 40 ? `${String(v).slice(0, 40)}…` : v}`);
}
