import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import type { MutationResult, PullResponse } from "@/lib/sync/protocol";
import { currentScope, localDb, metaValue, rememberScope, signOutLocally, type Scope } from "./db";
import { writeLocal } from "./outbox";
import { syncOnce } from "./sync";

let n = 0;
const scope = (): Scope => ({ userId: `user-${++n}`, organizationId: "org", role: "owner" });

// A fake server: decides each pushed mutation and serves a change log.
function server(opts: { decide?: (type: string) => MutationResult | "crash"; status?: number; changes?: PullResponse["changes"] } = {}) {
  const pushed: string[] = [];
  const log = [...(opts.changes ?? [])];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (opts.status) return new Response("{}", { status: opts.status });
    if (url.startsWith("/api/sync/push")) {
      const { mutations } = JSON.parse(String(init!.body)) as { mutations: { id: string; type: string }[] };
      const results = [];
      for (const m of mutations) {
        const decision = opts.decide?.(m.type) ?? { status: "applied" };
        if (decision === "crash") break;
        pushed.push(m.type);
        results.push({ id: m.id, ...decision });
      }
      return Response.json({ results });
    }
    const since = Number(new URL(url, "http://x").searchParams.get("since"));
    const changes = log.filter((c) => c.version > since);
    return Response.json({ version: changes.at(-1)?.version ?? since, hasMore: false, changes } satisfies PullResponse);
  }) as typeof fetch;
  return { fetchFn, pushed, log };
}

describe("outbox (ADR-003)", () => {
  let s: Scope;
  beforeEach(() => void (s = scope()));

  it("keeps offline writes, in order, across a reload (a new connection to the same database)", async () => {
    const db = localDb(s);
    await writeLocal(db, { type: "farm.save", payload: { name: "A" } }, { entity: "farm", id: "f1", data: { name: "A" } });
    await writeLocal(db, { type: "farm.save", payload: { name: "B" } }, { entity: "farm", id: "f1", data: { name: "B" } });

    const reopened = new Dexie(db.name);
    await reopened.open();
    expect((await reopened.table("outbox").toArray()).map((e) => e.payload)).toEqual([{ name: "A" }, { name: "B" }]);
    expect(await reopened.table("records").get("farm:f1")).toMatchObject({ data: { name: "B" } });
    reopened.close();
  });

  it("empties once the server applied everything, and records when", async () => {
    const db = localDb(s);
    await writeLocal(db, { type: "a", payload: {} });
    await writeLocal(db, { type: "b", payload: {} });
    const srv = server();

    expect(await syncOnce(db, s, srv.fetchFn)).toBe("ok");
    expect(srv.pushed).toEqual(["a", "b"]);
    expect(await db.outbox.count()).toBe(0);
    expect(await metaValue(db, "lastSyncAt")).toBeDefined();
  });

  it("moves a rejected mutation to 'needs attention' with its messageKey, drops its local copy and re-reads from 0", async () => {
    const db = localDb(s);
    await db.meta.put({ key: "cursor", value: 7 });
    await writeLocal(db, { type: "bad", payload: {} }, { entity: "farm", id: "f1", data: { name: "local only" } });
    await writeLocal(db, { type: "good", payload: {} });
    const srv = server({ decide: (t) => (t === "bad" ? { status: "rejected", messageKey: "errors.FORBIDDEN" } : { status: "applied" }) });

    expect(await syncOnce(db, s, srv.fetchFn)).toBe("ok");
    expect(await db.outbox.count()).toBe(0);
    expect(await db.needsAttention.toArray()).toEqual([expect.objectContaining({ type: "bad", messageKey: "errors.FORBIDDEN" })]);
    expect(await db.records.get("farm:f1")).toBeUndefined();
    expect(srv.pushed).toEqual(["bad", "good"]);
  });

  it("keeps everything from the first unprocessed mutation when the server stops, and when it can't be reached", async () => {
    const db = localDb(s);
    for (const type of ["a", "crash", "c"]) await writeLocal(db, { type, payload: {} });

    expect(await syncOnce(db, s, server({ decide: (t) => (t === "crash" ? "crash" : { status: "applied" }) }).fetchFn)).toBe("offline");
    expect((await db.outbox.toArray()).map((e) => e.type)).toEqual(["crash", "c"]);

    const unreachable = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    expect(await syncOnce(db, s, unreachable)).toBe("offline");
    expect(await db.outbox.count()).toBe(2);
    expect(await metaValue(db, "lastOutcome")).toBe("offline");
  });

  it("keeps the outbox when the session expired or belongs to someone else", async () => {
    const db = localDb(s);
    await writeLocal(db, { type: "a", payload: {} });
    expect(await syncOnce(db, s, server({ status: 401 }).fetchFn)).toBe("unauthenticated");
    expect(await syncOnce(db, s, server({ status: 409 }).fetchFn)).toBe("wrong-scope");
    expect(await db.outbox.count()).toBe(1);
  });
});

describe("pull merge (ADR-003)", () => {
  it("applies changes after the cursor, deletions included, and moves the cursor", async () => {
    const s = scope();
    const db = localDb(s);
    const srv = server({
      changes: [
        { entity: "farm", id: "f1", version: 1, data: { name: "v1" } },
        { entity: "house", id: "h1", version: 2, data: { name: "H1" } },
      ],
    });
    await syncOnce(db, s, srv.fetchFn);
    srv.log.push({ entity: "farm", id: "f1", version: 3, data: { name: "v2" } }, { entity: "house", id: "h1", version: 4, data: null });
    await syncOnce(db, s, srv.fetchFn);

    expect(await db.records.toArray()).toEqual([{ key: "farm:f1", entity: "farm", id: "f1", data: { name: "v2" } }]);
    expect(await metaValue(db, "cursor")).toBe(4);
  });

  it("doesn't overwrite a record saved on the phone while the pull was on its way", async () => {
    const s = scope();
    const db = localDb(s);
    const srv = server({ changes: [{ entity: "farm", id: "f1", version: 1, data: { name: "older, from the server" } }] });
    const savingDuringPull = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/sync/pull")) {
        await writeLocal(db, { type: "farm.save", payload: {} }, { entity: "farm", id: "f1", data: { name: "just typed" } });
      }
      return srv.fetchFn(url, init);
    }) as typeof fetch;

    await syncOnce(db, s, savingDuringPull);
    expect(await db.records.get("farm:f1")).toMatchObject({ data: { name: "just typed" } });
    expect(await db.outbox.count()).toBe(1); // goes up on the next round
  });

  it("at logout keeps only unsent and refused writes, and deletes the database when there are none", async () => {
    const [busy, idle] = [scope(), scope()];
    const db = localDb(busy);
    await writeLocal(db, { type: "unsent", payload: {} }, { entity: "farm", id: "f1", data: { name: "local" } });
    await db.records.put({ key: "farm:f2", entity: "farm", id: "f2", data: { name: "pulled" } });
    await db.meta.put({ key: "cursor", value: 9 });
    await rememberScope(busy);

    await signOutLocally(busy);
    expect(await currentScope()).toBeUndefined();
    expect(await db.records.count()).toBe(0);
    expect(await metaValue(db, "cursor")).toBeUndefined(); // next login pulls from 0
    expect(await db.outbox.count()).toBe(1);

    await localDb(idle).records.put({ key: "farm:f3", entity: "farm", id: "f3", data: {} });
    const name = localDb(idle).name;
    await signOutLocally(idle);
    expect(await Dexie.exists(name)).toBe(false);
  });

  it("keeps each user's data and outbox apart on a shared phone", async () => {
    const [a, b] = [scope(), scope()];
    await writeLocal(localDb(a), { type: "x", payload: {} });
    expect(await localDb(b).outbox.count()).toBe(0);
  });
});
