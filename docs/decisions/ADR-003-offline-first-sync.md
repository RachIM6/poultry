# ADR-003: Offline-first sync (local store + outbox + versioned pull)

## Status
Proposed. To be confirmed by the sync spike (tasks T8–T9).

## Date
2026-10-27

## Context
- Workers enter daily data on farms with no or weak internet, sometimes for days.
- Several devices (owner, manager, worker) may edit the same farm.
- The data is mostly **append-only**: daily entries, weighings, movements, sales. A few records are editable: the daily entry of a given day, batch details, farm settings.
- The app must never lose or duplicate an entry.

## Decision
1. **Local database:** Dexie (IndexedDB) on the device holds the data the user is allowed to see. UI reads come from the local database.
2. **Writes go local first.** Each write updates the local record and appends a **mutation** to an `outbox` table: `{ id: uuidv7, type, payload, createdAt }`. Record ids are UUIDv7 generated on the client.
3. **Push:** `POST /api/sync/push` sends outbox mutations in order. The server:
   - checks permissions and the tenant;
   - validates with the **same Zod schemas**;
   - applies each mutation **idempotently**: the mutation id is unique, and a replay returns the stored result;
   - returns one result per mutation (`applied` / `rejected` with a `messageKey`).
4. **Pull:** each change on the server increments a per-organisation **`version` counter** stored on the row. `GET /api/sync/pull?since=<version>` returns the rows changed since the client's cursor, including tombstones for deletions.
5. **Conflicts:**
   - Append-only records cannot conflict.
   - Editable records use **last write received by the server wins, field by field**. The overwritten values are kept in the audit log (ADR-006).
   - A daily entry is unique per `(batchId, farmDay)`. Two offline creations of the same day are merged into one record.
6. **When to sync:**
   - on app start, on the `online` event, and after each write when online;
   - every 60 s while the app is open;
   - through Background Sync on Android.
   - The UI always shows the number of pending changes and the last sync time.
7. **Rejected mutations** (validation or permission errors) stay visible in a "needs attention" list. They are never dropped silently.

## Alternatives Considered

### PowerSync / ElectricSQL (managed sync engines)
- Pros: solved conflict handling, live queries.
- Cons: extra service to host or pay for; adds to the data-location question (ADR-007); learning curve.
- Rejected for v1. Revisit if the home-made sync becomes a bottleneck.

### CRDTs (Yjs, Automerge)
- Pros: automatic merging.
- Cons: overkill for mostly append-only records; hard to query and validate on the server.
- Rejected.

### Online-only with a retry queue
- Pros: simplest to build.
- Cons: cannot browse history or KPIs offline, and that is the core use case.
- Rejected.

## Consequences
- Every module that can be written offline must define its mutation types and Zod schemas in `schema.ts`. These are shared by client and server.
- Server-generated values (stock valuation, KPIs) are computed again on the server. The client shows provisional values until the next pull.
- Uniqueness rules (one open batch per house, one entry per day) are checked on the client for a good user experience, and **enforced on the server**. When they are violated, the conflict is merged or rejected as a mutation result, never as a crash.
- Changing the protocol is on the "ask first" list in the SPEC.
