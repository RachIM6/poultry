import { closedBatchFigures, type BatchKpis } from "@/modules/flock/domain/kpi";

type Figures = Parameters<typeof closedBatchFigures>;

/**
 * The FCR, EPEF and average weight a batch's screens show (batch screen, report): a closed batch's final ones, feed ÷
 * kg sold and kg sold ÷ birds sold at closing (closedBatchFigures, as /compare), so the weight is the one the EPEF
 * uses; an open batch's estimate at its latest weighing (batchKpis).
 */
export function shownFcrEpef(
  b: Omit<Figures[0], "closedOn"> & { status: string; closedOn?: string | null },
  weighed: BatchKpis["weighed"],
  entries: Figures[1],
  sold: Figures[2],
): { fcr: number | null; epef: number | null; avgWeightGrams: number | null } {
  if (b.status !== "closed" || !b.closedOn) return { fcr: weighed?.fcr ?? null, epef: weighed?.epef ?? null, avgWeightGrams: weighed?.averageGrams ?? null };
  const f = closedBatchFigures({ ...b, closedOn: b.closedOn }, entries, sold);
  return { fcr: f.fcr, epef: f.epef, avgWeightGrams: f.avgWeightGrams };
}
