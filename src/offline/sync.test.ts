import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationResult, PullResponse } from "@/lib/sync/protocol";
import { cachedReference, currentScope, localDb, metaValue, rememberScope, signOutLocally, type Scope } from "./db";
import { writeLocal } from "./outbox";
import { refreshReference, syncOnce } from "./sync";

let n = 0;
const scope = (): Scope => ({ userId: `user-${++n}`, organizationId: "org", role: "owner" });

// A fake server: decides each pushed mutation and serves a change log; `pulls` lists each pull's query.
function server(opts: { decide?: (type: string) => MutationResult | "crash"; status?: number; changes?: PullResponse["changes"]; refuseRecords?: boolean } = {}) {
  const pushed: string[] = [];
  const pulls: string[] = [];
  const log = [...(opts.changes ?? [])];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (opts.status) return new Response("{}", { status: opts.status });
    if (url === "/api/reference") return new Response(null, { status: 404 });
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
    const params = new URL(url, "http://x").searchParams;
    pulls.push(params.toString());
    const records = params.get("records")?.split(",");
    if (records && opts.refuseRecords) return new Response("{}", { status: 400 });
    if (records) {
      // ADR-014 read-back: each asked record's latest change.
      const latest = log.filter((c) => records.includes(`${c.entity}:${c.id}`) && !log.some((l) => l.entity === c.entity && l.id === c.id && l.version > c.version));
      return Response.json({ version: 0, hasMore: false, changes: latest } satisfies PullResponse);
    }
    // The whole log after the cursor: the phone must handle a page as the old server sent it too.
    const since = Number(params.get("since"));
    const changes = log.filter((c) => c.version > since);
    return Response.json({ version: changes.at(-1)?.version ?? since, hasMore: false, changes } satisfies PullResponse);
  }) as typeof fetch;
  return { fetchFn, pushed, log, pulls };
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

  it("moves a rejected mutation to 'needs attention' with its messageKey and drops its local copy", async () => {
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
    expect(await metaValue(db, "cursor")).toBe(7); // ADR-014: no reset to 0
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

  it("applies a page of 1,000 changes in bulk, to the state applying them one by one gives", async () => {
    const s = scope();
    const db = localDb(s);
    for (let i = 0; i < 100; i++) await db.records.put({ key: `dailyEntry:e${i}`, entity: "dailyEntry", id: `e${i}`, data: { v: 0 } });
    // Updates, deletions, records changed several times in the page (the last change wins), some deleted then created again.
    const changes = Array.from({ length: 1_000 }, (_, i) => ({ entity: "dailyEntry", id: `e${i % 300}`, version: i + 1, data: i % 7 === 0 ? null : { v: i } }));
    const expected = new Map((await db.records.toArray()).map((r) => [r.key, r]));
    expected.set("dailyEntry:e7", { key: "dailyEntry:e7", entity: "dailyEntry", id: "e7", data: { local: true } });
    for (const c of changes) {
      const key = `${c.entity}:${c.id}`;
      if (key === "dailyEntry:e7") continue; // saved on the phone during the pull: its write is still queued
      if (c.data === null) expected.delete(key);
      else expected.set(key, { key, entity: c.entity, id: c.id, data: c.data });
    }
    const srv = server({ changes });
    const savingDuringPull = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/sync/pull")) await writeLocal(db, { type: "flock.recordDay", payload: {} }, { entity: "dailyEntry", id: "e7", data: { local: true } });
      return srv.fetchFn(url, init);
    }) as typeof fetch;
    const put = vi.spyOn(db.records, "put");
    const del = vi.spyOn(db.records, "delete");
    const bulkPut = vi.spyOn(db.records, "bulkPut");
    const bulkDelete = vi.spyOn(db.records, "bulkDelete");

    expect(await syncOnce(db, s, savingDuringPull)).toBe("ok");
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(bulkPut).toHaveBeenCalledTimes(2); // the local write, then the page
    expect(bulkDelete).toHaveBeenCalledTimes(2);
    const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
    expect((await db.records.toArray()).sort(byKey)).toEqual([...expected.values()].sort(byKey));
    expect(await metaValue(db, "cursor")).toBe(1_000);
  });

  it("replaces the phone's copy with a pull from 0, except records with a write still queued (ADR-014)", async () => {
    const s = scope();
    const db = localDb(s);
    await db.records.put({ key: "farm:gone", entity: "farm", id: "gone", data: { name: "deleted on the server" } });
    const srv = server({ changes: [{ entity: "house", id: "h1", version: 1, data: { name: "H1" } }] });
    const savingDuringPull = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/sync/pull")) await writeLocal(db, { type: "farm.save", payload: {} }, { entity: "farm", id: "mine", data: { name: "queued" } });
      return srv.fetchFn(url, init);
    }) as typeof fetch;

    await syncOnce(db, s, savingDuringPull);
    expect((await db.records.toArray()).map((r) => r.key).sort()).toEqual(["farm:mine", "house:h1"]);
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

describe("after a refused write (ADR-014)", () => {
  // The server's farm f1 arrives while a write to f1 is queued, so the pull skips it and moves on; then the write is
  // refused. Before ADR-014 the cursor went back to 0 to get f1 again.
  async function skippedThenRefused(srv: ReturnType<typeof server>) {
    const s = scope();
    const db = localDb(s);
    const savingDuringPull = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/sync/pull") && (await db.outbox.count()) === 0 && !(await metaValue(db, "cursor"))) {
        await writeLocal(db, { type: "farm.save", payload: {} }, { entity: "farm", id: "f1", data: { name: "refused" } });
      }
      return srv.fetchFn(url, init);
    }) as typeof fetch;
    await syncOnce(db, s, savingDuringPull);
    expect(await db.records.get("farm:f1")).toMatchObject({ data: { name: "refused" } });
    srv.pulls.length = 0;
    expect(await syncOnce(db, s, srv.fetchFn)).toBe("ok");
    return db;
  }
  const changes = () => [
    { entity: "farm", id: "f1", version: 1, data: { name: "server v1" } },
    { entity: "house", id: "h1", version: 2, data: { name: "H1" } },
    { entity: "farm", id: "f1", version: 3, data: { name: "server v2" } },
  ];
  const refuse = () => ({ status: "rejected", messageKey: "errors.FORBIDDEN" }) as const;

  it("keeps its cursor, reads back only the refused records, and ends with the server's state", async () => {
    const srv = server({ changes: changes(), decide: refuse });
    const db = await skippedThenRefused(srv);
    expect(srv.pulls).toEqual(["records=farm%3Af1", "since=3"]);
    expect(await metaValue(db, "cursor")).toBe(3);
    expect(await metaValue(db, "refetch")).toEqual([]);
    expect((await db.records.toArray()).map((r) => [r.key, r.data])).toEqual([
      ["farm:f1", { name: "server v2" }],
      ["house:h1", { name: "H1" }],
    ]);
  });

  it("reads everything again when the server can't read a record back", async () => {
    const srv = server({ changes: changes(), decide: refuse, refuseRecords: true });
    const db = await skippedThenRefused(srv);
    expect(srv.pulls).toEqual(["records=farm%3Af1", "since=0&snapshot=1"]);
    expect(await db.records.get("farm:f1")).toMatchObject({ data: { name: "server v2" } });
  });
});

describe("reference data cache (SPEC R4)", () => {
  const data = (n: number) => ({ strains: [], products: [], protocolTemplates: [{ id: `t${n}`, nameFr: "x", nameAr: "x", reviewedByVet: false, items: [] }] });

  it("keeps the server's copy, asks again with its ETag, and replaces it only when it changed", async () => {
    let served = { etag: '"v1"', body: data(1) };
    const sent: (string | null)[] = [];
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      const ifNoneMatch = new Headers(init?.headers).get("if-none-match");
      sent.push(ifNoneMatch);
      if (ifNoneMatch === served.etag) return new Response(null, { status: 304 });
      return Response.json(served.body, { headers: { etag: served.etag } });
    }) as typeof fetch;

    await refreshReference(fetchFn);
    expect(await cachedReference()).toMatchObject({ etag: '"v1"', data: data(1) });
    await refreshReference(fetchFn);
    served = { etag: '"v2"', body: data(2) };
    await refreshReference(fetchFn);
    expect(sent).toEqual([null, '"v1"', '"v1"']);
    expect(await cachedReference()).toMatchObject({ etag: '"v2"', data: data(2) });

    await refreshReference((async () => { throw new TypeError("offline"); }) as typeof fetch).catch(() => {});
    expect((await cachedReference())?.etag).toBe('"v2"'); // offline: the copy stays
  });
});

describe("a write that touched several records", () => {
  it("drops all of them from the phone when the server refuses it", async () => {
    const s = scope();
    const db = localDb(s);
    await writeLocal(db, { type: "inventory.recordPurchase", payload: {} }, [
      { entity: "purchase", id: "p1", data: { quantity: 1 } },
      { entity: "movement", id: "m1", data: { quantity: 1 } },
    ]);
    expect(await db.records.count()).toBe(2);
    await syncOnce(db, s, server({ decide: () => ({ status: "rejected", messageKey: "errors.NOT_FOUND" }) }).fetchFn);
    expect(await db.records.count()).toBe(0); // no stray movement left to inflate the stock shown
  });
});

describe("a role change on this phone (T25 S5)", () => {
  it("drops the cached records and pulls again from the start, keeping unsent writes", async () => {
    const manager = { ...scope(), role: "manager" as const };
    await rememberScope(manager);
    const db = localDb(manager);
    await db.records.put({ key: "sale:1", entity: "sale", id: "1", data: { amountCentimes: "900000" } });
    await db.meta.put({ key: "cursor", value: 42 });
    await writeLocal(db, { type: "flock.recordDay", payload: {} });

    await rememberScope({ ...manager, role: "manager" }); // same role: nothing to do
    expect(await db.records.count()).toBe(1);

    await rememberScope({ ...manager, role: "worker" });
    expect(await db.records.count()).toBe(0);
    expect(await metaValue(db, "cursor")).toBeUndefined(); // the next pull starts from 0, money stripped
    expect(await db.outbox.count()).toBe(1);
    expect((await currentScope())?.role).toBe("worker");
  });
});

describe("the name the header shows", () => {
  it("is kept when the dashboard remembers the scope without it, and dropped for another user", async () => {
    const me = scope();
    await rememberScope({ ...me, name: "Karim Ben Ahmed" });
    await rememberScope(me); // the dashboard's SyncBadge: no name
    expect((await currentScope())?.name).toBe("Karim Ben Ahmed");
    await rememberScope({ ...me, name: "Karim Alaoui" }); // changed on « Mes exploitations »
    expect((await currentScope())?.name).toBe("Karim Alaoui");
    await rememberScope({ ...me, userId: "someone-else" });
    expect((await currentScope())?.name).toBeUndefined();
  });

  it("is never lost when the header stores it while the dashboard stores the scope without it", async () => {
    const me = scope();
    await rememberScope(me); // a phone signed in before names
    // The header's rememberSignedIn and the dashboard's SyncBadge at the same time, in either order.
    await Promise.all([rememberScope({ ...me, name: "Karim Ben Ahmed" }), rememberScope(me)]);
    expect((await currentScope())?.name).toBe("Karim Ben Ahmed");
    await Promise.all([rememberScope({ ...me, role: "worker" }), rememberScope({ ...me, role: "worker", name: "Karim Alaoui" })]); // a role change clears records first
    expect(await currentScope()).toMatchObject({ role: "worker", name: "Karim Alaoui" });
  });
});
