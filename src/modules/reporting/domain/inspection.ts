import type { FarmDay } from "@/lib/kernel/farm-day";
import type { CleanoutDto, RodentCheckDto } from "@/modules/biosecurity/shared";
import { documentState, type DocumentDto } from "@/modules/documents/shared";
import type { BatchDto } from "@/modules/flock/shared";

// SPEC-m2-compliance RP4: the inspection pack of one farm, and what it lacks. The pieces follow the canvas and
// NEEDS-ANALYSIS §4 (authorization art. 1–3, designated vet art. 7, rodent proof art. 15); which pieces an inspector
// really asks for is CQ2.

/** How far back the pack looks: a choice, not a legal retention period (CQ5). */
export const INSPECTION_LOOKBACK_MONTHS = 12;

/** The first farm day the pack covers. Calendar months, so 5 Nov 2026 → 5 Nov 2025. */
// ponytail: a 31st or 29 Feb rolls one day into the next month; a day more or less of history is harmless here.
export function inspectionSince(today: FarmDay): FarmDay {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - INSPECTION_LOOKBACK_MONTHS, d)).toISOString().slice(0, 10) as FarmDay;
}

export type Missing =
  | { key: "authorization" | "authorizationExpired" | "vetContract" }
  | { key: "documentExpired"; title: string }
  | { key: "noDisinfection"; batchId: string }
  | { key: "rodentProof"; day: string };

type Input = {
  today: FarmDay;
  farm: { id: string; onssa: { number: string; expiresOn: string } | null };
  documents: DocumentDto[];
  batches: BatchDto[];
  cleanouts: CleanoutDto[];
  rodentChecks: RodentCheckDto[];
};

export function inspectionChecklist({ today, farm, documents, batches, cleanouts, rodentChecks }: Input): Missing[] {
  const since = inspectionSince(today);
  const docs = documents.filter((d) => d.farmId === null || d.farmId === farm.id);
  const valid = (category: DocumentDto["category"]) => docs.some((d) => d.category === category && documentState(d.expiresOn, today) !== "expired");
  const missing: Missing[] = [];

  if (farm.onssa) {
    if (documentState(farm.onssa.expiresOn, today) === "expired") missing.push({ key: "authorizationExpired" });
  } else if (!valid("authorization")) missing.push({ key: "authorization" });
  if (!valid("vetContract")) missing.push({ key: "vetContract" });
  for (const d of docs) if (documentState(d.expiresOn, today) === "expired") missing.push({ key: "documentExpired", title: d.title });
  for (const b of batches) {
    if (b.farmId !== farm.id || b.status !== "closed" || (b.closedOn ?? "") < since) continue;
    const cleanout = cleanouts.find((c) => c.afterBatchId === b.id);
    if (!cleanout?.steps.some((s) => s.step === "disinfection")) missing.push({ key: "noDisinfection", batchId: b.id });
  }
  for (const r of rodentChecks) if (r.farmId === farm.id && r.day >= since && !r.proofFileId) missing.push({ key: "rodentProof", day: r.day });
  return missing;
}
