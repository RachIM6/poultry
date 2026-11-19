import { Dexie, type EntityTable } from "dexie";
import type { Role } from "@/lib/tenant";

// ADR-003 local store. Runs in pages and in the service worker (Background Sync), so no React or Next imports here.

/** Who is signed in on this phone. Permissions only, never the credential (poultry-auth §9). */
export type Scope = { userId: string; organizationId: string; role: Role };
export const scopeKey = (s: Pick<Scope, "userId" | "organizationId">) => `${s.userId}:${s.organizationId}`;

export type OutboxEntry = { id: string; type: string; payload: unknown; createdAt: string; recordKey?: string };
export type RejectedEntry = OutboxEntry & { messageKey: string };
export type LocalRecord = { key: string; entity: string; id: string; data: unknown };
export type SyncOutcome = "ok" | "offline" | "unauthenticated" | "wrong-scope";
type Meta =
  | { key: "cursor"; value: number }
  | { key: "lastSyncAt"; value: string }
  | { key: "lastOutcome"; value: SyncOutcome };

export type LocalDb = Dexie & {
  outbox: EntityTable<OutboxEntry, "id">; // UUIDv7 ids: key order is creation order
  needsAttention: EntityTable<RejectedEntry, "id">;
  records: EntityTable<LocalRecord, "key">; // "<entity>:<id>"
  meta: EntityTable<Meta, "key">;
};

const open = new Map<string, LocalDb>();

/** One database per user and organisation: a shared phone never mixes two people's data or outboxes. */
export function localDb(scope: Pick<Scope, "userId" | "organizationId">): LocalDb {
  const name = `poultry-${scopeKey(scope)}`;
  let db = open.get(name);
  if (!db) {
    db = new Dexie(name) as LocalDb;
    db.version(1).stores({ outbox: "id", needsAttention: "id", records: "key, entity", meta: "key" });
    open.set(name, db);
  }
  return db;
}

export const metaValue = async <K extends Meta["key"]>(db: LocalDb, key: K) =>
  (await db.meta.get(key))?.value as Extract<Meta, { key: K }>["value"] | undefined;

// The device remembers who signed in last, so static offline pages and the service worker open the right database.
type Device = Dexie & { session: EntityTable<{ key: "current"; scope: Scope }, "key"> };
let device: Device | undefined;
function deviceDb(): Device {
  if (!device) {
    device = new Dexie("poultry-device") as Device;
    device.version(1).stores({ session: "key" });
  }
  return device;
}

export const currentScope = async () => (await deviceDb().session.get("current"))?.scope;
export const rememberScope = (scope: Scope) => deviceDb().session.put({ key: "current", scope });

/**
 * At logout, on a phone others may use: the cached farm data goes; only the user's unfinished work stays (unsent
 * writes and refused ones to check, poultry-auth §0.5). With nothing left, the database goes too. The next login
 * pulls everything again from version 0.
 */
export async function signOutLocally(scope: Scope) {
  await deviceDb().session.delete("current");
  const db = localDb(scope);
  const unfinished = await db.transaction("rw", db.outbox, db.needsAttention, db.records, db.meta, async () => {
    await Promise.all([db.records.clear(), db.meta.clear()]);
    return (await db.outbox.count()) + (await db.needsAttention.count());
  });
  if (unfinished === 0) {
    open.delete(db.name);
    await db.delete();
  }
}
