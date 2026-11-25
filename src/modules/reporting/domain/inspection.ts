import type { FarmDay } from "@/lib/kernel/farm-day";
import type { CleanoutDto, RodentCheckDto } from "@/modules/biosecurity/shared";
import { documentState, type DocumentDto } from "@/modules/documents/shared";
import type { BatchDto, ProductionType } from "@/modules/flock/shared";
import { REQUIRED_VACCINES, type VaccinationDto, type VetVisitDto } from "@/modules/health/shared";
import { batchMonths } from "@/modules/reporting/domain/register";

// SPEC-m2-compliance RP4: the inspection pack of one farm and its checklist. ONSSA publishes no inspection grid (CQ2):
// each line is an obligation of the texts in docs/sources/onssa/, with its source printed next to it.

/**
 * Arrêté n° 2126-05, art. 9: the register is kept at least 1 year after the birds leave for meat poultry, 2 years for
 * breeders and laying hens. Pullets are future layers: kept 2 years too (a safe default, CQ5).
 */
export const INSPECTION_LOOKBACK_MONTHS = { meat: 12, laying: 24 } as const;
export const lookbackMonths = (species: ProductionType) => (species === "layer" || species === "pullet" ? INSPECTION_LOOKBACK_MONTHS.laying : INSPECTION_LOOKBACK_MONTHS.meat);

/** The first farm day `months` calendar months back, so 5 Nov 2026 − 12 → 5 Nov 2025. The logs look back 12 months. */
// ponytail: a 31st or 29 Feb rolls one day into the next month; a day more or less of history is harmless here.
export function inspectionSince(today: FarmDay, months: number = INSPECTION_LOOKBACK_MONTHS.meat): FarmDay {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - months, d)).toISOString().slice(0, 10) as FarmDay;
}

/** Is this batch's register still in the pack: open, or left within its retention period. */
export const inPack = (b: BatchDto, today: FarmDay) => b.status === "open" || (b.closedOn ?? "") >= inspectionSince(today, lookbackMonths(b.species));

export type Missing =
  | { key: "authorization" | "authorizationExpired" | "vetContract" | "noRodentCheck" }
  | { key: "vetVisa"; batchId: string; month: string }
  | { key: "noDisinfection"; batchId: string }
  | { key: "rodentProof"; day: string }
  | { key: "downtime"; batchId: string; days: number }
  | { key: "downtimeOccupied"; batchId: string; houseId: string }
  | { key: "newcastle" | "newcastleLot"; batchId: string };

/** `check`: the app can't tell; the keeper checks it on site and ticks it on paper (self-declaration). */
export type CheckState = "ok" | "missing" | "check";
export const CHECKLIST = ["authorization", "vetContract", "register", "annexes", "water", "cleaning", "rodents", "carcasses", "downtime", "newcastle", "installations", "buildings", "manure", "layerStores"] as const;
export type CheckKey = (typeof CHECKLIST)[number];

/** Each line's source, printed as is (official French titles; docs/sources/onssa/README.md). */
export const CHECK_SOURCES: Record<CheckKey, string> = {
  authorization: "Loi n° 49-99, art. 1 et 2",
  vetContract: "Arrêté n° 2124-05, art. 1 ; loi n° 49-99, art. 7",
  register: "Arrêté n° 2126-05, art. 7, 8 et 16",
  annexes: "Arrêté n° 2126-05, art. 2 et 5",
  water: "Décret n° 2-04-684, art. 8 (modifié par le décret n° 2-23-111)",
  cleaning: "Arrêté n° 2127-05, art. 2",
  rodents: "Arrêté n° 2127-05, art. 2 ; loi n° 49-99, art. 15",
  carcasses: "Arrêté n° 2127-05, art. 2 ; loi n° 49-99, art. 12",
  downtime: "Arrêté n° 2127-05, art. 4",
  newcastle: "Arrêté n° 3308-17, art. 13 et 14",
  installations: "Arrêté n° 2127-05, art. 2 et 4",
  buildings: "Arrêté n° 2127-05, art. 4",
  manure: "Arrêté n° 2127-05, art. 4 ; décret n° 2-04-684, art. 12",
  layerStores: "Arrêté n° 2127-05, art. 4", // "les fermes de poules pondeuses": only with a layer batch in the pack
};

export type CheckLine = { key: CheckKey; state: CheckState; source: string; missing: Missing[] };

type Input = {
  today: FarmDay;
  farm: { id: string; onssa: { number: string; expiresOn: string } | null };
  documents: DocumentDto[];
  batches: BatchDto[];
  cleanouts: CleanoutDto[];
  rodentChecks: RodentCheckDto[];
  vetVisits: VetVisitDto[];
  vaccinations: VaccinationDto[];
  stockItems: { id: string; lot: string | null }[];
  /**
   * Arrêté n° 2127-05, art. 4 (CQ3): planning's one rule for a batch's placement, given by the app layer (reporting
   * doesn't depend on planning): too few days since the farm's (or, for layers, the house's) last end, or another
   * house still holding a batch of the previous cycle.
   */
  downtimeOf: (b: BatchDto) => { kind: "short"; elapsedDays: number } | { kind: "occupied"; houseId: string } | null;
};

export function inspectionChecklist({ today, farm, documents, batches, cleanouts, rodentChecks, vetVisits, vaccinations, stockItems, downtimeOf }: Input): CheckLine[] {
  const since = inspectionSince(today);
  const docs = documents.filter((d) => d.farmId === null || d.farmId === farm.id);
  const valid = (category: DocumentDto["category"]) => docs.some((d) => d.category === category && documentState(d.expiresOn, today) !== "expired");
  const farmBatches = batches.filter((b) => b.farmId === farm.id);
  const pack = farmBatches.filter((b) => inPack(b, today));
  const closed = farmBatches.filter((b) => b.status === "closed" && (b.closedOn ?? "") >= since);
  const checks = rodentChecks.filter((r) => r.farmId === farm.id && r.day >= since);
  const line = (key: CheckKey, missing: Missing[], ok = true): CheckLine => ({ key, state: missing.length > 0 ? "missing" : ok ? "ok" : "check", source: CHECK_SOURCES[key], missing });

  const authorization: Missing[] = farm.onssa
    ? documentState(farm.onssa.expiresOn, today) === "expired" ? [{ key: "authorizationExpired" }] : []
    : valid("authorization") ? [] : [{ key: "authorization" }];

  // Art. 7: a month of a batch's life without a vet visit. An open batch's current month isn't over yet.
  // ponytail: a visit stands for the visa; whether the vet signed it is on paper.
  const thisMonth = today.slice(0, 7);
  const visas: Missing[] = pack.flatMap((b) =>
    batchMonths(b, today)
      .filter((month) => (b.status === "closed" || month < thisMonth) && !vetVisits.some((v) => v.batchId === b.id && v.on.startsWith(month)))
      .map((month) => ({ key: "vetVisa" as const, batchId: b.id, month })),
  );

  const disinfected = (b: BatchDto) => cleanouts.find((c) => c.afterBatchId === b.id)?.steps.some((s) => s.step === "disinfection");
  const noDisinfection: Missing[] = closed.filter((b) => !disinfected(b)).map((b) => ({ key: "noDisinfection", batchId: b.id }));

  const rodents: Missing[] = checks.length === 0 ? [{ key: "noRodentCheck" }] : checks.filter((r) => !r.proofFileId).map((r) => ({ key: "rodentProof", day: r.day }));

  // Art. 4, CQ3: a short downtime or a previous-cycle batch is missing; a long one is still to confirm on site.
  const downtime: Missing[] = pack.flatMap((b): Missing[] => {
    const w = downtimeOf(b);
    return !w ? [] : w.kind === "short" ? [{ key: "downtime", batchId: b.id, days: w.elapsedDays }] : [{ key: "downtimeOccupied", batchId: b.id, houseId: w.houseId }];
  });

  // S6 art. 13–14: Newcastle vaccination is compulsory, each one recorded with its lot number. Missing: none planned,
  // one past its day and not done, or one done without a lot.
  const lot = (id: string) => stockItems.find((s) => s.id === id)?.lot;
  const newcastle = pack.flatMap((b): Missing[] => {
    const lines = vaccinations.filter((v) => v.batchId === b.id && REQUIRED_VACCINES.some((r) => r.disease === "newcastle" && r.productId === v.productId));
    if (lines.length === 0 || lines.some((v) => !v.done && v.dueOn < today)) return [{ key: "newcastle", batchId: b.id }];
    return lines.some((v) => v.done && !lot(v.done.stockItemId)) ? [{ key: "newcastleLot", batchId: b.id }] : [];
  });

  return [
    line("authorization", authorization),
    line("vetContract", valid("vetContract") ? [] : [{ key: "vetContract" }]),
    line("register", visas),
    line("annexes", [], false),
    line("water", [], false),
    line("cleaning", noDisinfection, closed.length > 0),
    line("rodents", rodents),
    line("carcasses", [], false),
    line("downtime", downtime, false),
    line("newcastle", newcastle, pack.length > 0),
    line("installations", [], false),
    line("buildings", [], false),
    line("manure", [], false),
    ...(pack.some((b) => b.species === "layer") ? [line("layerStores", [], false)] : []),
  ];
}
