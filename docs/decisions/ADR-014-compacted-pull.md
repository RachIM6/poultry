# ADR-014: A compacted pull (a snapshot from 0) and no full re-download after a refused write

## Status
Accepted (decided default, to review). Decided 2026-11-24 under the product owner's standing instruction to decide and build without waiting (SPEC §7 lists protocol changes as "ask first"). Amends [ADR-003](ADR-003-offline-first-sync.md): its implementation notes "Client merge" (cursor reset on a refusal) and "Later: compact the change log".

## Date
2026-11-24

## Context
- Performance audit finding M3. The pull (`GET /api/sync/pull?since=<version>`, `src/lib/sync/server.ts`) pages through **every** `Change` row after the cursor, 1 000 rows a page. `Change` is never compacted: each edit of a record adds a row, and a deletion adds a tombstone.
- A pull from `since = 0` therefore downloads the organisation's **whole write history**, superseded versions and deleted records included. It grows with history, not with the current state. It happens when:
  - a new phone signs in, or a user signs in again after a logout (ADR-003 T9: the local copy is cleared);
  - a member's role changes (T25 S5: the phone clears its records and pulls again);
  - **any write is refused** (`src/offline/sync.ts`: one rejection set `cursor = 0`).
- That is the worst case on a 3G connection, and the refusal case repeats it for each refused write. ADR-003 accepted the reset because "rejections are rare". A refusal is a normal outcome of offline work, though (a closed batch, a locked period, a role changed while the phone was offline), so it should not cost a full download.
- The reset exists for a real reason. While a write to a record is queued, the pull skips the server's changes to that record but moves the cursor past them. When the write is then refused, the phone drops its local copy, and those skipped changes lie behind the cursor. Reading everything again was how ADR-003 got them back.

## Decision

### 1. The pull is compacted, from any cursor
For each record `(entity, entityId)`, the pull returns only its **latest** change, and only when that change's version is after the cursor. Changes come in version order, at most `PULL_PAGE` a page. A page's `version` (the next cursor) is the version of its last row, as before.

```sql
SELECT entity, "entityId", version, data FROM "Change" c
WHERE "organizationId" = $org AND version > $since
  AND NOT EXISTS (SELECT 1 FROM "Change" l
                  WHERE l."organizationId" = c."organizationId" AND l.entity = c.entity
                    AND l."entityId" = c."entityId" AND l.version > c.version)
ORDER BY version LIMIT 1000
```

- **The cursor is stable.** Versions are unique and increasing per organisation, and the query walks the primary key `(organizationId, version)` in order. The anti-join is one probe per row on a new index, `(organizationId, entity, entityId, version)` (migration `20261125010000_change_record_index`).
- **Why compact every pull, not only from 0.** A snapshot of more than one page continues with `since > 0`. A full replay from there would bring back most of the history. Compacting every pull also helps a phone that comes back after a week offline. The phone never needed the superseded rows: it keeps only the latest value of each record.
- **Paging uses the version as its cursor**, with no separate "max version at snapshot start" token. The guarantee is the same, and it needs no new cursor in the wire format.

### 2. From 0, a phone that asks for it gets a snapshot without deleted records
- A new phone sends `since=0&snapshot=1`. The server then also leaves out every record whose latest change is a deletion, so the first page holds only live records.
- Because a snapshot carries no tombstones, the phone **replaces** its copy with it. On the first page, it deletes every local record that has no write queued, then applies the page. This covers a cursor that went back to 0 while records were still on the phone (see §4, fallback).
- Later pages of the same snapshot are ordinary compacted pulls (`since > 0`). They may hold a tombstone for a record deleted after the first page's cursor. Each such record is sent once, and the phone deletes a record it doesn't have.

### 3. Why nothing written during a snapshot is lost
- **The invariant:** after applying a page that ends at cursor `C`, the phone holds the latest change of every record whose latest change, when the page was read, was at or below `C`.
  - The page is the first 1 000 "latest" rows after the previous cursor, in version order, and its cursor is the last of them. So every latest row up to `C` was sent, on this page or an earlier one.
  - Versions become visible in order (ADR-003: the counter row stays locked until commit), so no row at or below `C` can appear later.
- **A write during paging** gets a version `V` above every version visible when the earlier pages were read, so `V > C`. The record's latest change is now `V`.
  - If the record was already sent, its new version is sent when the cursor reaches `V`.
  - If it was not sent yet, its older row stops being "latest" and is skipped, and `V` is sent instead.
  - A deletion is a change like any other: past the first page it travels as a tombstone.
  - A new record is simply a latest change above `C`.
- **When the last page ends** (`hasMore: false`), its version is the newest change the phone needs. The next incremental pull continues from there, exactly as before.
- Tested in `src/lib/sync/server.int.test.ts`, "compacted pull (ADR-014)":
  - 1 500 records with several updates, deletions and re-creations: the snapshot equals a full replay, sends each record once, and needs more than one page;
  - an incremental pull from the snapshot's version equals a full replay;
  - updates, deletions and a creation made between the first page and the rest are all there at the end;
  - another organisation sees nothing.

### 4. A refused write reads back only its records; the cursor stays
- On a rejection, the phone still drops the local copies of the write's records. It no longer resets the cursor. Instead, it adds their keys (`"<entity>:<id>"`, already kept on each outbox entry) to `meta.refetch`.
- The next pull first asks for those records: `GET /api/sync/pull?records=<entity>:<id>,...`, at most `MAX_PULL_RECORDS` (100) per request.
  - The server returns each record's latest change, deletions included, whatever the cursor.
  - It applies the same organisation filter, serializers and `PULL_VIEWS` as any pull.
- The phone applies only the keys it asked for, still skipping records that have a write queued. Then it removes those keys from `refetch` and goes on with the normal pull from its unchanged cursor.
  - A change the server returns that is newer than the cursor comes again in the normal pull, which is harmless.
  - `refetch` lives in IndexedDB, so a lost connection between the push and the read-back loses nothing.
- **Fallback:** if the server answers 400 to a read-back (a key it can't parse), the phone goes back to ADR-003's behaviour. It resets the cursor to 0, which is now a snapshot.
- **Why this option.**
  - Keeping the reset is still a full download per refusal: a snapshot is smaller than the history, but it is the whole state.
  - Lowering the cursor to the refused record's last version needs a version per local record. It also misses changes that were skipped while the write was queued.
  - Reading the records back by key is correct whatever was skipped, costs one small request, and is about 20 lines on each side.
  - ADR-003's "rejections are rare" reasoning would have been acceptable if the targeted fix were complex. It isn't.

### 5. Roles, views and money are unchanged
The snapshot, the compacted pull and the read-back select rows. Every selected row then goes through the same code as before: unlisted entities are dropped, the role's `PULL_VIEWS` allowlist applies (ADR-013), and the serializers strip money and drop other users' records. `src/app/api/sync/visibility.int.test.ts` checks this for every role. Each role's snapshot holds exactly the records of its full pull, without deletions. Workers and vets still receive no money field.

### 6. Wire format: additive, older phones keep working
- **The response shape is unchanged** (`PullResponse`).
- **New, optional query parameters:**
  - `snapshot=1`, only meaningful with `since=0`;
  - `records=...`, for the read-back.
- **A phone running the old code against the new server:**
  - It sends `since=0` with no `snapshot`, so it gets a compacted pull **with** tombstones. That is one row per record ever written, not per change. Applied on top of whatever it holds, the result is the current state, exactly as a full replay would give.
  - Its cursor semantics are unchanged, so its incremental pulls continue as before.
  - Its reset after a refusal now costs a compacted pull instead of the history.
- **A new phone against an old server** (a rollback):
  - The old route ignores the unknown parameters.
  - A snapshot request gets a full replay from 0. That is correct, but the phone's first-page clear is then redundant.
  - A read-back request gets the first page of the history. The phone keeps only the keys it asked for. They could be older than the record's latest version until that record changes again.
  - Phones load the app from the server, so this only lasts until they reload after a rollback.

## Alternatives Considered

### `DISTINCT ON (entity, "entityId")` over the organisation's changes
- Pros: the textbook "latest per key" query.
- Cons: it computes the latest of every record on every page, so a snapshot of `n` pages reads the whole log `n` times.
- Rejected: the anti-join walks the log once over all the pages, because each page starts where the last one stopped.

### A separate snapshot cursor in the wire format (`next`, frozen at the snapshot's start)
- Pros: the snapshot leaves out every deleted record, not only those on its first page.
- Cons:
  - it needs a new response field and client loop;
  - a phone running the old code would follow `version` and skip the rest of the snapshot, so the server could serve it only to phones that ask for it.
- Rejected: the version is already a stable cursor (§3).

### Compacting the `Change` table itself (deleting superseded rows)
- Pros: smaller table, and every reader gets the compaction for free.
- Cons: finance's posting sources read one entity's changes past their own cursor (SPEC-finance FN7). Deleting rows they have not read yet changes what they post.
- Rejected for now: it needs its own decision with finance.

### A "latest change per record" table maintained by `recordChange`
- Pros: a snapshot page becomes one index range, however long the history.
- Cons: a second write per change, a new table and a backfill migration.
- Kept as the upgrade path (below).

### Keeping the cursor reset after a refusal
- See §4. Rejected: it is still a full download per refused write.

## Consequences
- A first pull downloads the current state, not the history. For example, 30 000 records with 10 versions each are about 30 pages instead of about 300.
- Incremental pulls after a long time offline shrink the same way. A pull with nothing new is still an index range that returns nothing (under 1 ms in the measurement below).
- Each change insert now updates one more index on `Change`.
- Database cost, measured with `EXPLAIN ANALYZE` on 600 000 changes, two organisations, 30 000 records × 10 versions, Postgres 18 in Docker Desktop:
  - the worst case is the first snapshot page when every superseded row comes first: it walks about 270 000 rows in 2.5 s (warm) to 3.6 s (cold);
  - each later page starts from its cursor;
  - a read-back of 2 records takes about 3 ms;
  - without the new index, the planner hashes the whole log on every page (about 1.5 s each time).
  - Mostly append-only history (ADR-003: daily entries, movements, sales) has few superseded rows, so the first page walks little more than 1 000 rows.
- The phone's first-page clear and the first page land in one transaction, so after a reset to 0 the screens show only the records already pulled until the snapshot's last page. Today that only happens on the 400 fallback; sign-in and role changes already clear the copy.
- A snapshot of more than one page can carry a few tombstones for records deleted while it was being taken, or deleted after its first page's cursor. Each costs about 90 bytes and is sent once.
- The sync protocol changed: `SPEC.md` §7 points here.

## To review later
- **Server time for very long histories.** If the first snapshot page of a real organisation takes more than about 1 s, maintain a latest-per-record table in `recordChange` (alternative above), or compact `Change` once finance's posting cursors allow it.
- **Number of tombstones in multi-page snapshots.** If deletions grow (corrections, unticked tasks), consider the separate snapshot cursor above.
- **Whether `MAX_PULL_RECORDS = 100`** fits the largest refused batches. A batch of up to 500 mutations reads back in several requests. That is correct, but there are more round trips.
- **The rollback gap in §6.** It applies only to a new phone talking to an old server.
