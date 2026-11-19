import { v7 as uuidv7 } from "uuid";
import type { LocalDb, OutboxEntry } from "./db";
import { requestSync } from "./sync";

type LocalChange = { entity: string; id: string; data: unknown };

/**
 * ADR-003: a write updates the local records it affects (a purchase and its stock movement, say) and queues its
 * mutation, in one transaction, then asks for a sync. `data: null` deletes the local copy. Throws on a full disk
 * (QuotaExceededError): the caller must say so, never pretend it was saved (poultry-pwa §0.8).
 */
export async function writeLocal(
  db: LocalDb,
  mutation: { type: string; payload: unknown },
  records: LocalChange | LocalChange[] = [],
): Promise<OutboxEntry> {
  const changes = Array.isArray(records) ? records : [records];
  const recordKeys = changes.map((r) => `${r.entity}:${r.id}`);
  const entry: OutboxEntry = { id: uuidv7(), ...mutation, createdAt: new Date().toISOString(), recordKeys };
  await db.transaction("rw", db.outbox, db.records, async () => {
    for (const [i, change] of changes.entries()) {
      if (change.data === null) await db.records.delete(recordKeys[i]);
      else await db.records.put({ key: recordKeys[i], ...change });
    }
    await db.outbox.add(entry);
  });
  requestSync();
  return entry;
}
