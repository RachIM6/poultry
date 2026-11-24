import type { LocalRecord } from "./db";

const none: never[] = [];

/**
 * A screen's records grouped once per live-query result, by entity and by entity and batch: a low-end phone then reads
 * a batch's rows without scanning the whole history again for each card. The arrays are shared: copy before sorting.
 */
export function groupRecords(records: readonly LocalRecord[]) {
  const byEntity = new Map<string, unknown[]>();
  const byBatch = new Map<string, unknown[]>();
  const add = (groups: Map<string, unknown[]>, key: string, data: unknown) => {
    const group = groups.get(key);
    if (group) group.push(data);
    else groups.set(key, [data]);
  };
  for (const r of records) {
    add(byEntity, r.entity, r.data);
    const batchId = (r.data as { batchId?: unknown } | null)?.batchId;
    if (typeof batchId === "string") add(byBatch, `${r.entity}:${batchId}`, r.data);
  }
  return {
    of: <T,>(entity: string) => (byEntity.get(entity) ?? none) as T[],
    ofBatch: <T,>(entity: string, batchId: string) => (byBatch.get(`${entity}:${batchId}`) ?? none) as T[],
  };
}
