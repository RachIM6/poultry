import { Dexie, type EntityTable } from "dexie";
import type { Role } from "@/lib/tenant";
import type { ReferenceData } from "@/modules/reference-data/schema";

// ADR-003 local store. Runs in pages and in the service worker (Background Sync), so no React or Next imports here.

/**
 * Who is signed in on this phone. Permissions only, never the credential (poultry-auth §9). `name`: what the header
 * shows (« Prénom Nom », or the phone of an account made before names), from /api/sync/scope.
 */
export type Scope = { userId: string; organizationId: string; role: Role; name?: string };
export const scopeKey = (s: Pick<Scope, "userId" | "organizationId">) => `${s.userId}:${s.organizationId}`;

export type OutboxEntry = { id: string; type: string; payload: unknown; createdAt: string; recordKeys?: string[] };
export type RejectedEntry = OutboxEntry & { messageKey: string; messageValues?: Record<string, string | number> }; // not indexed: no new version
export type LocalRecord = { key: string; entity: string; id: string; data: unknown };
export type SyncOutcome = "ok" | "offline" | "unauthenticated" | "wrong-scope";
type Meta =
  | { key: "cursor"; value: number }
  | { key: "refetch"; value: string[] } // ADR-014: "<entity>:<id>" of refused writes, to read back from the server
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

/**
 * Saves local records, or deletes them (`data: null`), in bulk inside the caller's transaction: one bulkDelete and one
 * bulkPut, not a request per record. The last change to a key wins, as applying them one by one in order would.
 */
export async function applyRecords(db: LocalDb, changes: Iterable<{ entity: string; id: string; data: unknown }>) {
  const latest = new Map<string, LocalRecord | null>();
  for (const { entity, id, data } of changes) {
    const key = `${entity}:${id}`;
    latest.set(key, data === null ? null : { key, entity, id, data });
  }
  await db.records.bulkDelete([...latest].flatMap(([key, record]) => (record ? [] : [key])));
  await db.records.bulkPut([...latest.values()].filter((record) => record !== null));
}

export const metaValue = async <K extends Meta["key"]>(db: LocalDb, key: K) =>
  (await db.meta.get(key))?.value as Extract<Meta, { key: K }>["value"] | undefined;

// The device remembers who signed in last, so static offline pages and the service worker open the right database.
// Reference data (R4) lives here too: it is the same for every user and organisation, and holds no farm data.
type Device = Dexie & {
  session: EntityTable<{ key: "current"; scope: Scope }, "key">;
  reference: EntityTable<{ key: "current"; etag: string; data: ReferenceData }, "key">;
};
let device: Device | undefined;
function deviceDb(): Device {
  if (!device) {
    device = new Dexie("poultry-device") as Device;
    device.version(2).stores({ session: "key", reference: "key" });
  }
  return device;
}

export const currentScope = async () => (await deviceDb().session.get("current"))?.scope;
export async function rememberScope(scope: Scope) {
  const before = await currentScope();
  if (before && scopeKey(before) === scopeKey(scope) && before.role !== scope.role) {
    // T25 S5: a new role pulls everything again, so prices a demoted worker may no longer see leave the phone.
    // Unsent writes stay (poultry-auth §0.5); the server re-checks them against the new role.
    const db = localDb(scope);
    await db.transaction("rw", db.records, db.meta, () => Promise.all([db.records.clear(), db.meta.clear()]));
  }
  // The dashboard remembers the scope without the name: the same user keeps the one the phone has.
  const name = scope.name ?? (before?.userId === scope.userId ? before.name : undefined);
  await deviceDb().session.put({ key: "current", scope: { ...scope, ...(name !== undefined && { name }) } });
}

export const cachedReference = () => deviceDb().reference.get("current");
export const storeReference = (etag: string, data: ReferenceData) => deviceDb().reference.put({ key: "current", etag, data });

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
