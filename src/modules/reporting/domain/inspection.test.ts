import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { BatchDto } from "@/modules/flock/shared";
import { REQUIRED_VACCINES } from "@/modules/health/shared";
import { CHECKLIST, INSPECTION_LOOKBACK_MONTHS, inPack, inspectionChecklist, inspectionSince, lookbackMonths } from "./inspection";

const today = "2026-11-05" as FarmDay;
const doc = (category: string, expiresOn: string | null, over: object = {}) => ({ id: `${category}${expiresOn}`, title: category, category, farmId: null, issuedOn: null, expiresOn, notes: null, fileId: "f", ...over }) as never;
const batch = (over: Partial<BatchDto> = {}) => ({ id: "b13", farmId: "farm", houseId: "h", species: "broiler", status: "closed", placedOn: "2026-09-21", closedOn: "2026-11-03", ...over }) as BatchDto;
const visit = (batchId: string, on: string) => ({ id: on, batchId, on, vetName: "Dr N.", notes: "", byUserId: "u" });
const nd = (batchId: string, over: object = {}) => ({ id: `nd${batchId}`, batchId, dayOfAge: 7, dueOn: "2026-09-28", productId: REQUIRED_VACCINES[0].productId, method: "drinkingWater", done: { on: "2026-09-28", stockItemId: "s-nd", doses: 10000, method: "drinkingWater", byUserId: "u" }, ...over }) as never;
const complete = {
  today,
  farm: { id: "farm", onssa: { number: "A", expiresOn: "2027-03-15" } },
  documents: [doc("vetContract", "2026-12-31")],
  batches: [batch()],
  cleanouts: [{ id: "c", farmId: "farm", houseId: "h", afterBatchId: "b13", startedOn: "2026-11-03", steps: [{ id: "s", step: "disinfection", day: "2026-11-05", product: "V", dose: null, productLot: null, note: null }] }],
  rodentChecks: [{ id: "r", farmId: "farm", houseId: null, day: "2026-11-05", action: "baitPlaced", product: null, proofFileId: "p" }],
  vetVisits: [visit("b13", "2026-09-25"), visit("b13", "2026-10-22"), visit("b13", "2026-11-02")],
  vaccinations: [nd("b13")],
  stockItems: [{ id: "s-nd", lot: "ND-771" }],
  downtimeOf: () => null,
} as Parameters<typeof inspectionChecklist>[0];
const states = (lines: ReturnType<typeof inspectionChecklist>) => Object.fromEntries(lines.map((l) => [l.key, l.state]));
const missingOf = (lines: ReturnType<typeof inspectionChecklist>) => lines.flatMap((l) => l.missing);

// SPEC-m2-compliance RP4, CQ2: the checklist lines, each with its official source; CQ5: the period by production type.
describe("inspection pack", () => {
  it("looks back 1 year for meat batches, 2 years for layers and pullets (arrêté n° 2126-05 art. 9)", () => {
    expect(INSPECTION_LOOKBACK_MONTHS).toEqual({ meat: 12, laying: 24 });
    expect([lookbackMonths("broiler"), lookbackMonths("turkey"), lookbackMonths("layer"), lookbackMonths("pullet")]).toEqual([12, 12, 24, 24]);
    expect(inspectionSince(today)).toBe("2025-11-05");
    expect(inspectionSince(today, 24)).toBe("2024-11-05");
    const closedOn = "2025-06-30"; // 16 months ago
    expect(inPack(batch({ closedOn }), today)).toBe(false);
    expect(inPack(batch({ closedOn, species: "layer" }), today)).toBe(true);
    expect(inPack(batch({ status: "open", closedOn: undefined }), today)).toBe(true);
  });

  it("every line in order with its source; all recorded: nothing missing, the rest to check on site", () => {
    const lines = inspectionChecklist(complete);
    expect(lines.map((l) => l.key)).toEqual([...CHECKLIST]);
    expect(lines.map((l) => [l.key, l.source])).toEqual([
      ["authorization", "Loi n° 49-99, art. 1 et 2"],
      ["vetContract", "Arrêté n° 2124-05, art. 1 ; loi n° 49-99, art. 7"],
      ["register", "Arrêté n° 2126-05, art. 7, 8 et 16"],
      ["annexes", "Arrêté n° 2126-05, art. 2 et 5"],
      ["water", "Décret n° 2-04-684, art. 8 (modifié par le décret n° 2-23-111)"],
      ["cleaning", "Arrêté n° 2127-05, art. 2"],
      ["rodents", "Arrêté n° 2127-05, art. 2 ; loi n° 49-99, art. 15"],
      ["carcasses", "Arrêté n° 2127-05, art. 2 ; loi n° 49-99, art. 12"],
      ["downtime", "Arrêté n° 2127-05, art. 4"],
      ["newcastle", "Arrêté n° 3308-17, art. 13 et 14"],
      ["installations", "Arrêté n° 2127-05, art. 2 et 4"],
    ]);
    expect(missingOf(lines)).toEqual([]);
    expect(states(lines)).toEqual({
      authorization: "ok", vetContract: "ok", register: "ok", annexes: "check", water: "check", cleaning: "ok", rodents: "ok", carcasses: "check", downtime: "check", newcastle: "ok", installations: "check",
    });
  });

  it("lists each missing piece under its line", () => {
    const lines = inspectionChecklist({
      ...complete,
      farm: { id: "farm", onssa: { number: "A", expiresOn: "2026-11-01" } },
      documents: [doc("vetContract", "2026-10-31"), doc("vetContract", "2027-10-31", { farmId: "other" })],
      cleanouts: [],
      rodentChecks: [{ id: "r", farmId: "farm", houseId: null, day: "2026-11-05", action: "baitPlaced", product: null, proofFileId: null }],
      vetVisits: [visit("b13", "2026-10-22")],
      stockItems: [{ id: "s-nd", lot: null }],
    });
    expect(lines.filter((l) => l.state === "missing").map((l) => [l.key, l.missing])).toEqual([
      ["authorization", [{ key: "authorizationExpired" }]],
      ["vetContract", [{ key: "vetContract" }]],
      ["register", [{ key: "vetVisa", batchId: "b13", month: "2026-09" }, { key: "vetVisa", batchId: "b13", month: "2026-11" }]],
      ["cleaning", [{ key: "noDisinfection", batchId: "b13" }]],
      ["rodents", [{ key: "rodentProof", day: "2026-11-05" }]],
      ["newcastle", [{ key: "newcastleLot", batchId: "b13" }]],
    ]);
  });

  it("no authorization at all; no rodent check at all", () => {
    const missing = missingOf(inspectionChecklist({ ...complete, farm: { id: "farm", onssa: null }, rodentChecks: [] }));
    expect(missing).toEqual([{ key: "authorization" }, { key: "noRodentCheck" }]);
  });

  it("an open batch's current month needs no visa yet; a past one does", () => {
    const open = batch({ id: "b14", status: "open", placedOn: "2026-10-10", closedOn: undefined });
    const lines = inspectionChecklist({ ...complete, batches: [batch(), open], vaccinations: [nd("b13"), nd("b14", { dueOn: "2026-11-20", done: null })] });
    expect(lines.find((l) => l.key === "register")?.missing).toEqual([{ key: "vetVisa", batchId: "b14", month: "2026-10" }]);
    expect(lines.find((l) => l.key === "newcastle")?.missing).toEqual([]); // not due yet
  });

  it("Newcastle: missing when none is planned or one is past its day undone", () => {
    expect(inspectionChecklist({ ...complete, vaccinations: [] }).find((l) => l.key === "newcastle")?.missing).toEqual([{ key: "newcastle", batchId: "b13" }]);
    expect(inspectionChecklist({ ...complete, vaccinations: [nd("b13", { done: null })] }).find((l) => l.key === "newcastle")?.missing).toEqual([{ key: "newcastle", batchId: "b13" }]);
  });

  it("downtime: planning's rule (arrêté n° 2127-05 art. 4, CQ3) marks a short one or a previous-cycle batch missing", () => {
    // planning's batchDowntime is tested in planning/domain/plan.test.ts; the screen passes it in (reporting doesn't depend on planning)
    const next = batch({ id: "b14", status: "open", placedOn: "2026-11-20", closedOn: undefined });
    const later = { ...complete, today: "2026-11-25" as FarmDay, batches: [batch(), next], vetVisits: [...complete.vetVisits, visit("b14", "2026-11-21")], vaccinations: [nd("b13"), nd("b14", { dueOn: "2026-11-27", done: null })] };
    const short = (b: BatchDto) => (b.id === "b14" ? { kind: "short" as const, elapsedDays: 17 } : null);
    const busy = (b: BatchDto) => (b.id === "b14" ? { kind: "occupied" as const, houseId: "h2" } : null);
    expect(inspectionChecklist({ ...later, downtimeOf: short }).find((l) => l.key === "downtime")).toMatchObject({ state: "missing", missing: [{ key: "downtime", batchId: "b14", days: 17 }] });
    expect(inspectionChecklist({ ...later, downtimeOf: busy }).find((l) => l.key === "downtime")?.missing).toEqual([{ key: "downtimeOccupied", batchId: "b14", houseId: "h2" }]);
    expect(inspectionChecklist(later).find((l) => l.key === "downtime")).toMatchObject({ state: "check", missing: [] });
  });
});
