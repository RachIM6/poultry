import { MAX_MUTATIONS_PER_PUSH, SCOPE_HEADER, type PullResponse, type PushResponse } from "@/lib/sync/protocol";
import { localDb, metaValue, scopeKey, type LocalDb, type Scope, type SyncOutcome } from "./db";

type Fetch = typeof fetch;
const BACKGROUND_SYNC_TAG = "poultry-outbox";
const INTERVAL_MS = 60_000; // ADR-003 §6

/**
 * One round: push the outbox in order, then pull until up to date. Safe to call anytime; the outcome is stored in
 * `meta` so every screen shows it. Never drops a queued mutation: only `applied` or `rejected` results remove one.
 */
export async function syncOnce(db: LocalDb, scope: Scope, fetchFn: Fetch = fetch): Promise<SyncOutcome> {
  let outcome: SyncOutcome;
  try {
    outcome = await pushOutbox(db, scope, fetchFn);
    if (outcome === "ok") outcome = await pullChanges(db, scope, fetchFn);
  } catch {
    outcome = "offline"; // fetch failed: no network
  }
  await db.meta.put({ key: "lastOutcome", value: outcome });
  if (outcome === "ok") await db.meta.put({ key: "lastSyncAt", value: new Date().toISOString() });
  return outcome;
}

// The scope header lets the server refuse a push or pull made with another user's session (409).
const headers = (scope: Scope) => ({ "x-requested-with": "poultry", [SCOPE_HEADER]: scopeKey(scope) });

function failure(status: number): SyncOutcome | undefined {
  if (status === 401) return "unauthenticated";
  if (status === 409) return "wrong-scope";
  if (status !== 200) return "offline"; // 429, 5xx: try again later
}

async function pushOutbox(db: LocalDb, scope: Scope, fetchFn: Fetch): Promise<SyncOutcome> {
  for (;;) {
    const batch = await db.outbox.orderBy("id").limit(MAX_MUTATIONS_PER_PUSH).toArray();
    if (batch.length === 0) return "ok";
    const res = await fetchFn("/api/sync/push", {
      method: "POST",
      headers: { ...headers(scope), "content-type": "application/json" },
      body: JSON.stringify({ mutations: batch.map(({ id, type, payload, createdAt }) => ({ id, type, payload, createdAt })) }),
    });
    const failed = failure(res.status);
    if (failed) return failed;
    const { results } = (await res.json()) as PushResponse;

    await db.transaction("rw", db.outbox, db.needsAttention, db.records, db.meta, async () => {
      for (const result of results) {
        const entry = batch.find((e) => e.id === result.id);
        if (!entry) continue;
        await db.outbox.delete(entry.id);
        if (result.status === "rejected") {
          await db.needsAttention.put({ ...entry, messageKey: result.messageKey }); // ADR-003 §7: never dropped silently
          // The local copy showed a write the server refused: drop it and read everything again from the server.
          // ponytail: a full re-pull per rejection; rejections are rare. Re-pull one entity if they aren't.
          if (entry.recordKey) await db.records.delete(entry.recordKey);
          await db.meta.put({ key: "cursor", value: 0 });
        }
      }
    });
    if (results.length < batch.length) return "offline"; // the server stopped on an error: the rest waits
  }
}

async function pullChanges(db: LocalDb, scope: Scope, fetchFn: Fetch): Promise<SyncOutcome> {
  for (;;) {
    const since = (await metaValue(db, "cursor")) ?? 0;
    const res = await fetchFn(`/api/sync/pull?since=${since}`, { headers: headers(scope) });
    const failed = failure(res.status);
    if (failed) return failed;
    const page = (await res.json()) as PullResponse;

    await db.transaction("rw", db.records, db.outbox, db.meta, async () => {
      // A record with a write still queued keeps its local value; the server's change for that write comes later.
      const pending = new Set((await db.outbox.toArray()).map((e) => e.recordKey));
      for (const change of page.changes) {
        const key = `${change.entity}:${change.id}`;
        if (pending.has(key)) continue;
        if (change.data === null) await db.records.delete(key);
        else await db.records.put({ key, entity: change.entity, id: change.id, data: change.data });
      }
      await db.meta.put({ key: "cursor", value: page.version });
    });
    if (!page.hasMore) return "ok";
  }
}

// One loop per signed-in scope on this page, however many components ask for it.
const engines = new Map<string, { run: () => Promise<void>; users: number; stop: () => void }>();

/** ADR-003 §6: sync now, when the network returns, when the app comes back to the front, and every 60 s. */
export function startSync(scope: Scope): () => void {
  const key = scopeKey(scope);
  let engine = engines.get(key);
  if (!engine) {
    const db = localDb(scope);
    let running: Promise<void> | undefined;
    const run = () => (running ??= syncOnce(db, scope).then(() => undefined).finally(() => (running = undefined)));
    const onVisible = () => document.visibilityState === "visible" && void run();
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible); // iPhone has no Background Sync
    const timer = setInterval(run, INTERVAL_MS);
    const stop = () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
      engines.delete(key);
    };
    engine = { run, users: 0, stop };
    engines.set(key, engine);
  }
  engine.users++;
  void engine.run();
  const e = engine;
  return () => {
    if (--e.users === 0) e.stop();
  };
}

/** After a local write: sync now if the page has a loop, and let Android finish it later if the page closes. */
export function requestSync() {
  for (const engine of engines.values()) void engine.run();
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready
    .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register(BACKGROUND_SYNC_TAG))
    .catch(() => {}); // not supported (iPhone, Firefox): the loop above covers it
}

export { BACKGROUND_SYNC_TAG };
