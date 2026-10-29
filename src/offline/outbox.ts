import { v7 as uuidv7 } from "uuid";
import type { LocalDb, OutboxEntry } from "./db";
import { requestSync } from "./sync";

/**
 * ADR-003: a write updates the local record and queues its mutation in one transaction, then asks for a sync.
 * `record.data: null` deletes the local copy. Throws on a full disk (QuotaExceededError): the caller must say so,
 * never pretend it was saved (poultry-pwa §0.8).
 */
export async function writeLocal(
  db: LocalDb,
  mutation: { type: string; payload: unknown },
  record?: { entity: string; id: string; data: unknown },
): Promise<OutboxEntry> {
  const recordKey = record && `${record.entity}:${record.id}`;
  const entry: OutboxEntry = { id: uuidv7(), ...mutation, createdAt: new Date().toISOString(), recordKey };
  await db.transaction("rw", db.outbox, db.records, async () => {
    if (record && recordKey) {
      if (record.data === null) await db.records.delete(recordKey);
      else await db.records.put({ key: recordKey, ...record });
    }
    await db.outbox.add(entry);
  });
  requestSync();
  return entry;
}
