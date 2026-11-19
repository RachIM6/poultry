import type { FarmDay } from "@/lib/kernel/farm-day";
import { batchKpis, type BatchDto, type DailyEntryDto, type SoldBirdsDto, type WeighingDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto } from "@/modules/health/shared";

// SPEC-m2-compliance RP3 (SCOPE §13): the batch report. KPIs and health from the phone's records with flock's own
// formulas, money from finance's batch result (FN13) as the server computed it, so it always equals /results.

/** Finance's result of one batch, centimes as strings (it crosses from the server page to the phone's screen). */
export type ResultRow = {
  id: string;
  salesCentimes: string;
  costCentimes: string;
  marginCentimes: string;
  soldGrams: number;
  costPerKgCentimes: string | null;
  marginPerKgCentimes: string | null;
  marginPermille: string | null;
};

type Input = {
  batch: BatchDto;
  today: FarmDay;
  batches: BatchDto[];
  entries: DailyEntryDto[];
  weighings: WeighingDto[];
  sold: SoldBirdsDto[];
  vaccinations: VaccinationDto[];
  treatments: TreatmentDto[];
  results: ResultRow[] | null; // null: the viewer may not see money
};

function figures(b: BatchDto, i: Pick<Input, "entries" | "weighings" | "sold" | "today">) {
  const entries = i.entries.filter((e) => e.batchId === b.id);
  const sold = i.sold.filter((s) => s.batchId === b.id);
  const k = batchKpis({ placedOn: b.placedOn as FarmDay, birdsStarted: b.chicksPlaced - b.deadOnArrival, dayOldWeightGrams: b.dayOldWeightGrams }, entries, i.weighings.filter((w) => w.batchId === b.id), (b.closedOn ?? i.today) as FarmDay, sold);
  const feedGrams = entries.reduce((n, e) => n + (e.feed?.grams ?? 0), 0);
  const soldGrams = sold.reduce((n, s) => n + s.liveWeightGrams, 0);
  return {
    ...k,
    placed: b.chicksPlaced,
    dead: entries.reduce((n, e) => n + e.dead + e.culled, 0),
    sold: sold.reduce((n, s) => n + s.birds, 0),
    soldGrams,
    feedGrams,
    // A closed batch: feed over the live weight that left (all of it was sold). Open: from the latest weighing.
    fcr: b.status === "closed" ? (soldGrams > 0 ? feedGrams / soldGrams : null) : (k.weighed?.fcr ?? null),
  };
}

export function buildBatchReport(i: Input) {
  const { batch } = i;
  const result = (id: string) => i.results?.find((r) => r.id === id) ?? null;
  const vaccinations = i.vaccinations.filter((v) => v.batchId === batch.id);
  const treatments = i.treatments.filter((t) => t.batchId === batch.id);
  return {
    kpis: figures(batch, i),
    health: {
      vaccinesDone: vaccinations.filter((v) => v.done).length,
      vaccinesPlanned: vaccinations.length,
      treatments: treatments.length,
      lastWithdrawalEnd: treatments.map((t) => t.withdrawalEndsOn).sort().at(-1) ?? null,
    },
    money: result(batch.id),
    // FN13's comparison: this batch and the same farm's earlier closed ones, newest first.
    comparison: i.batches
      .filter((b) => b.farmId === batch.farmId && b.placedOn <= batch.placedOn && (b.id === batch.id || b.status === "closed"))
      .sort((x, y) => y.placedOn.localeCompare(x.placedOn))
      .map((b) => {
        const f = figures(b, i);
        const r = result(b.id);
        return { id: b.id, placedOn: b.placedOn, mortalityPercent: f.mortalityPercent, fcr: f.fcr, costPerKgCentimes: r?.costPerKgCentimes ?? null, marginPerKgCentimes: r?.marginPerKgCentimes ?? null };
      }),
  };
}

export type BatchReport = ReturnType<typeof buildBatchReport>;
