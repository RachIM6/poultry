import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { withoutMoney } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { twoTenants } from "@/test/tenant";
import type { PullResponse, PushedMutation } from "./protocol";
import { defineMutation, pull, push, recordChange, type SyncRegistry } from "./server";

// Test-only entity until farms arrive (T10): a note with a money field.
type Note = { text: string; priceCentimes?: string };
let failNext = false;
const registry: SyncRegistry = {
  mutations: {
    "test.saveNote": defineMutation({
      schema: z.object({ id: z.uuid(), text: z.string().min(1), priceCentimes: z.string().optional() }),
      action: "organization.read",
      async apply(tx, ctx, { id, ...note }, meta) {
        if (note.text === "reject me") return fail("NOT_FOUND");
        if (failNext) throw new Error("database hiccup");
        await recordChange(tx, ctx, "note", id, note);
        await tx.auditEvent.create({
          data: { organizationId: ctx.organizationId, userId: ctx.userId, entity: "note", entityId: id, action: "save", after: note, mutationId: meta.mutationId, deviceCreatedAt: meta.deviceCreatedAt },
        });
        return ok(undefined);
      },
    }),
    "test.deleteNote": defineMutation({
      schema: z.object({ id: z.uuid() }),
      action: "organization.manage", // owners only
      async apply(tx, ctx, { id }) {
        await recordChange(tx, ctx, "note", id, null);
        return ok(undefined);
      },
    }),
    "test.takenId": defineMutation({
      schema: z.object({ id: z.uuid() }),
      action: "organization.read",
      async apply(tx, ctx, { id }) {
        // A uniqueness violation the handler didn't check for: the id is already a mutation's.
        await tx.mutation.create({ data: { id, organizationId: ctx.organizationId, userId: ctx.userId, type: "test", result: {} } });
        return ok(undefined);
      },
    }),
    "test.slow": defineMutation({
      schema: z.object({}),
      action: "organization.read",
      async apply(tx) {
        await tx.$executeRaw`SELECT pg_sleep(5.5)`; // past Prisma's 5 s default transaction timeout
        return ok(undefined);
      },
    }),
  },
  entities: { note: (ctx, data: Note) => withoutMoney(ctx, data, ["priceCentimes"]) },
};

let n = 0;
const uuid = () => `0190a000-0000-7000-8000-${String(++n).padStart(12, "0")}`;
const mutation = (type: string, payload: unknown): PushedMutation => ({ id: uuid(), type, payload, createdAt: "2026-10-29T08:00:00+01:00" });
const save = (id: string, text: string, priceCentimes?: string) => mutation("test.saveNote", { id, text, priceCentimes });

describe("sync push (ADR-003)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => ([a, b] = await twoTenants()));

  it("applies a mutation once: a replay returns the stored result without applying it again", async () => {
    const m = save(uuid(), "first");
    expect(await push(a, [m], registry)).toEqual({ results: [{ id: m.id, status: "applied" }] });
    expect(await push(a, [m], registry)).toEqual({ results: [{ id: m.id, status: "applied" }] });
    expect(await db.auditEvent.count({ where: { mutationId: m.id } })).toBe(1);
    expect(await db.change.count({ where: { organizationId: a.organizationId, entityId: (m.payload as { id: string }).id } })).toBe(1);
  });

  it("applies it once when the same mutation arrives twice at the same moment", async () => {
    const m = save(uuid(), "twice");
    const [one, two] = await Promise.all([push(a, [m], registry), push(a, [m], registry)]);
    expect([one, two]).toEqual([{ results: [{ id: m.id, status: "applied" }] }, { results: [{ id: m.id, status: "applied" }] }]);
    expect(await db.auditEvent.count({ where: { mutationId: m.id } })).toBe(1);
  });

  it("rejects bad mutations with a messageKey and still applies the valid ones in the batch", async () => {
    const worker = { ...a, role: "worker" as const };
    const batch = [
      mutation("test.unknown", {}),
      mutation("test.saveNote", { id: "not-a-uuid", text: "x" }),
      save(uuid(), "reject me"),
      mutation("test.deleteNote", { id: uuid() }), // a worker may not delete
      save(uuid(), "valid"),
    ];
    const { results } = await push(worker, batch, registry);
    expect(results.map((r) => (r.status === "rejected" ? r.messageKey : r.status))).toEqual([
      "errors.UNKNOWN_MUTATION",
      "errors.INVALID_INPUT",
      "errors.NOT_FOUND",
      "errors.FORBIDDEN",
      "applied",
    ]);
    expect((await push(worker, batch, registry)).results).toEqual(results); // rejections replay too
  });

  it("stops at an unexpected error, records nothing for it, and applies it on the retry", async () => {
    const [ok1, broken, after] = [save(uuid(), "before"), save(uuid(), "breaks"), save(uuid(), "after")];
    await push(a, [ok1], registry);
    failNext = true;
    expect((await push(a, [broken, after], registry)).results).toEqual([]);
    failNext = false;
    expect(await db.mutation.count({ where: { id: { in: [broken.id, after.id] } } })).toBe(0);
    expect((await push(a, [broken, after], registry)).results.map((r) => r.status)).toEqual(["applied", "applied"]);
  });

  it("rejects a mutation whose write hits a taken id, keeps nothing of it, and applies what follows", async () => {
    const taken = save(uuid(), "taken");
    await push(a, [taken], registry);
    const [dup, after] = [mutation("test.takenId", { id: taken.id }), save(uuid(), "after")];
    const results = (await push(a, [save(uuid(), "before"), dup, after], registry)).results;
    expect(results.map((r) => (r.status === "rejected" ? r.messageKey : r.status))).toEqual(["applied", "errors.ALREADY_EXISTS", "applied"]);
    expect(await db.mutation.findUniqueOrThrow({ where: { id: dup.id } })).toMatchObject({ organizationId: a.organizationId, result: { status: "rejected" } });
    expect(await push(a, [dup], registry)).toEqual({ results: [{ id: dup.id, status: "rejected", messageKey: "errors.ALREADY_EXISTS" }] }); // replayed, not retried
  });

  it("applies a mutation that runs longer than Prisma's default 5 s transaction timeout", async () => {
    const m = mutation("test.slow", {});
    expect(await push(a, [m], registry)).toEqual({ results: [{ id: m.id, status: "applied" }] });
  }, 20_000);

  it("never replays or applies another organisation's mutation id", async () => {
    const m = save(uuid(), "a's note");
    await push(a, [m], registry);
    expect(await push(b, [m], registry)).toEqual({ results: [{ id: m.id, status: "rejected", messageKey: "errors.FORBIDDEN" }] });
    expect((await pull(b, 0, registry)).changes).toEqual([]);
  });
});

describe("sync pull (ADR-003)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "Organization", "User", "Mutation", "Change", "SyncVersion", "AuditEvent" CASCADE`);
    [a, b] = await twoTenants();
  });

  it("returns exactly what changed after the cursor, deletions included, for the caller's organisation only", async () => {
    const [x, y] = [uuid(), uuid()];
    await push(a, [save(x, "x v1", "1500"), save(y, "y v1")], registry);
    await push(b, [save(uuid(), "b's note")], registry);
    const first = await pull(a, 0, registry);
    expect(first.changes.map((c) => [c.id, c.data])).toEqual([
      [x, { text: "x v1", priceCentimes: "1500" }],
      [y, { text: "y v1" }],
    ]);

    await push(a, [save(x, "x v2"), mutation("test.deleteNote", { id: y })], registry);
    const next = await pull(a, first.version, registry);
    expect(next.changes.map((c) => [c.id, c.data])).toEqual([
      [x, { text: "x v2" }],
      [y, null], // tombstone
    ]);
    expect(await pull(a, next.version, registry)).toEqual({ version: next.version, hasMore: false, changes: [] });
    expect((await pull(b, 0, registry)).changes.map((c) => c.data)).toEqual([{ text: "b's note" }]);
  });

  it("strips money for workers and leaves out entities no module declared", async () => {
    await push(a, [save(uuid(), "priced", "9900")], registry);
    await db.$transaction((tx) => recordChange(tx, a, "secret", uuid(), { priceCentimes: "1" }));
    const worker = { ...a, role: "worker" as const };
    const changes = (await pull(worker, 0, registry)).changes;
    expect(changes.some((c) => c.entity === "secret")).toBe(false);
    expect(changes.length).toBeGreaterThan(0);
    expect(JSON.stringify(changes)).not.toMatch(/priceCentimes|9900|1500/);
  });
});

describe("compacted pull (ADR-014)", () => {
  type State = Map<string, unknown>;
  let a: TenantContext, b: TenantContext;
  const ids = Array.from({ length: 1500 }, () => uuid()); // more live records than one page (PULL_PAGE)
  beforeAll(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "Organization", "User", "Mutation", "Change", "SyncVersion", "AuditEvent" CASCADE`);
    [a, b] = await twoTenants();
    await write(a, ids.map((id) => [id, { text: "v1", priceCentimes: "100" }]));
    await write(a, ids.map((id) => [id, { text: "v2", priceCentimes: "200" }]));
    await write(a, ids.flatMap((id, i) => (i % 3 === 0 ? [[id, { text: "v3" }]] : [])));
    await write(a, ids.flatMap((id, i) => (i % 5 === 0 ? [[id, null]] : [])));
    await write(a, ids.flatMap((id, i) => (i % 50 === 0 ? [[id, { text: "back" }]] : []))); // deleted, then created again
    await write(b, [[uuid(), { text: "b's note" }]]);
  });

  /** Many changes at once, numbered as recordChange numbers them. */
  async function write(ctx: TenantContext, changes: [id: string, data: Note | null][]) {
    await db.$transaction(async (tx) => {
      const [{ version }] = await tx.$queryRaw<{ version: bigint }[]>`
        INSERT INTO "SyncVersion" ("organizationId", version) VALUES (${ctx.organizationId}::uuid, ${changes.length})
        ON CONFLICT ("organizationId") DO UPDATE SET version = "SyncVersion".version + ${changes.length}
        RETURNING version`;
      const first = version - BigInt(changes.length) + 1n;
      await tx.change.createMany({
        data: changes.map(([entityId, data], i) => ({ organizationId: ctx.organizationId, version: first + BigInt(i), entity: "note", entityId, data: data ?? Prisma.DbNull })),
      });
    });
  }

  /** The whole log replayed in order: what every phone must end up with. */
  async function replay(ctx: TenantContext, strip = (n: Note): unknown => n) {
    const state: State = new Map();
    for (const c of await db.change.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { version: "asc" } })) {
      if (c.data === null) state.delete(c.entityId);
      else state.set(c.entityId, strip(c.data as Note));
    }
    return state;
  }

  /** Pulls page by page from `since` into `state`, as the phone does; `between` runs after the first page. */
  async function pullInto(ctx: TenantContext, state: State, since = 0, between?: (sent: string[]) => Promise<void>, reg = registry, snapshot = true) {
    const pages: PullResponse[] = [];
    for (let more = true; more; ) {
      const page = await pull(ctx, since, reg, { snapshot });
      pages.push(page);
      for (const c of page.changes) {
        if (c.data === null) state.delete(c.id);
        else state.set(c.id, c.data);
      }
      [since, more] = [page.version, page.hasMore];
      if (pages.length === 1) await between?.(page.changes.map((c) => c.id));
    }
    return { version: since, pages, sent: pages.flatMap((p) => p.changes) };
  }

  it("from 0, returns exactly the current state, each record once, deleted ones left out of the first page", async () => {
    const state: State = new Map();
    const { version, pages, sent } = await pullInto(a, state);
    expect(state).toEqual(await replay(a));
    expect(state.size).toBe(ids.filter((_, i) => i % 5 !== 0 || i % 50 === 0).length);
    expect(pages.length).toBeGreaterThan(1);
    expect(new Set(sent.map((c) => c.id)).size).toBe(sent.length);
    expect(sent.length).toBeLessThan(await db.change.count({ where: { organizationId: a.organizationId } }) / 2);
    expect(pages[0].changes.filter((c) => c.data === null)).toEqual([]);
    expect(version).toBe(Number((await db.syncVersion.findUniqueOrThrow({ where: { organizationId: a.organizationId } })).version));
  });

  it("still gives a phone that doesn't ask for a snapshot (older code) each deletion, once per record", async () => {
    const state: State = new Map([[ids[5], { text: "held by an older phone" }]]);
    const { sent } = await pullInto(a, state, 0, undefined, registry, false);
    expect(state).toEqual(await replay(a));
    expect(new Set(sent.map((c) => c.id)).size).toBe(sent.length);
    expect(sent.filter((c) => c.data === null).length).toBe(ids.filter((_, i) => i % 5 === 0 && i % 50 !== 0).length);
  });

  it("an incremental pull from the snapshot's version ends where a full replay does", async () => {
    const state: State = new Map();
    const { version } = await pullInto(a, state);
    await write(a, [[ids[1], { text: "later" }], [ids[2], null], [ids[0], null], [uuid(), { text: "new" }], [ids[1], { text: "later again" }]]);
    await pullInto(a, state, version);
    expect(state).toEqual(await replay(a));
  });

  it("loses nothing written while the snapshot is being paged", async () => {
    const state: State = new Map();
    await pullInto(a, state, 0, async (sent) => {
      const live = [...(await replay(a)).keys()];
      const [sentA, sentB] = live.filter((id) => sent.includes(id));
      const [laterA, laterB] = live.filter((id) => !sent.includes(id));
      // Records already sent and records still to come, each updated or deleted, and a new one.
      await write(a, [[sentA, { text: "edited after it was sent" }], [laterA, { text: "edited before it was sent" }], [sentB, null], [laterB, null], [uuid(), { text: "created mid-snapshot" }]]);
    });
    expect(state).toEqual(await replay(a));
    expect([...state.values()]).toEqual(expect.arrayContaining([{ text: "edited after it was sent" }, { text: "edited before it was sent" }, { text: "created mid-snapshot" }]));
  });

  it("strips money for a worker and keeps a partner within their view, as the incremental pull does", async () => {
    const worker: State = new Map();
    await pullInto({ ...a, role: "worker" }, worker);
    expect(worker).toEqual(await replay(a, (n) => withoutMoney({ ...a, role: "worker" }, n, ["priceCentimes"])));
    expect(JSON.stringify([...worker.values()])).not.toMatch(/priceCentimes/);
    const vet: State = new Map();
    const { sent } = await pullInto({ ...a, role: "vet" }, vet, 0, undefined, { ...registry, views: { vet: ["farm"] } });
    expect(sent).toEqual([]);
  });

  it("reads back given records, deletions included, whatever the cursor, and never another organisation's", async () => {
    const [live, deleted] = [ids[3], ids[5]];
    const records = [live, deleted].map((id) => ({ entity: "note", id }));
    const { version } = await pullInto(a, new Map());
    const got = (await pull(a, version, registry, { records })).changes;
    expect(new Map(got.map((c) => [c.id, c.data]))).toEqual(new Map([[live, (await replay(a)).get(live)], [deleted, null]]));
    expect((await pull(b, 0, registry, { records })).changes).toEqual([]);
  });

  it("gives another organisation none of these records", async () => {
    const theirs: State = new Map();
    await pullInto(b, theirs);
    expect([...theirs.values()]).toEqual([{ text: "b's note" }]);
  });
});
