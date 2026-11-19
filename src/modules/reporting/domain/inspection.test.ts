import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { INSPECTION_LOOKBACK_MONTHS, inspectionChecklist, inspectionSince } from "./inspection";

const today = "2026-11-05" as FarmDay;
const doc = (category: string, expiresOn: string | null, over: object = {}) => ({ id: `${category}${expiresOn}`, title: category, category, farmId: null, issuedOn: null, expiresOn, notes: null, fileId: "f", ...over }) as never;

// SPEC-m2-compliance RP4: what the pack holds and what it lists as missing. The list itself is provisional (CQ2).
describe("inspection pack", () => {
  it("looks back 12 months", () => {
    expect(INSPECTION_LOOKBACK_MONTHS).toBe(12);
    expect(inspectionSince(today)).toBe("2025-11-05");
  });

  it("all present: nothing missing", () => {
    const missing = inspectionChecklist({
      today,
      farm: { id: "farm", onssa: { number: "A", expiresOn: "2027-03-15" } },
      documents: [doc("vetContract", "2026-12-31")],
      batches: [{ id: "b13", farmId: "farm", status: "closed", placedOn: "2026-09-21", closedOn: "2026-11-03" }] as never,
      cleanouts: [{ id: "c", farmId: "farm", houseId: "h", afterBatchId: "b13", startedOn: "2026-11-03", steps: [{ id: "s", step: "disinfection", day: "2026-11-05", product: "V", dose: null, productLot: null, note: null }] }],
      rodentChecks: [{ id: "r", farmId: "farm", houseId: null, day: "2026-11-05", action: "baitPlaced", product: null, proofFileId: "p" }],
    });
    expect(missing).toEqual([]);
  });

  it("lists each missing piece: authorization, expired document, clean-out without disinfection, check without proof, vet contract", () => {
    const missing = inspectionChecklist({
      today,
      farm: { id: "farm", onssa: { number: "A", expiresOn: "2026-11-01" } },
      documents: [doc("insurance", "2026-10-31"), doc("vetContract", "2026-10-31", { farmId: "other" })],
      batches: [{ id: "b13", farmId: "farm", status: "closed", placedOn: "2026-09-21", closedOn: "2026-11-03" }] as never,
      cleanouts: [],
      rodentChecks: [{ id: "r", farmId: "farm", houseId: null, day: "2026-11-05", action: "baitPlaced", product: null, proofFileId: null }],
    });
    expect(missing).toEqual([
      { key: "authorizationExpired" },
      { key: "vetContract" },
      { key: "documentExpired", title: "insurance" },
      { key: "noDisinfection", batchId: "b13" },
      { key: "rodentProof", day: "2026-11-05" },
    ]);
  });

  it("no authorization at all is missing too", () => {
    expect(inspectionChecklist({ today, farm: { id: "farm", onssa: null }, documents: [doc("vetContract", null)], batches: [], cleanouts: [], rodentChecks: [] })).toEqual([{ key: "authorization" }]);
  });
});
