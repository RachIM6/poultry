import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { withoutMoney } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { twoTenants } from "@/test/tenant";
import type { PushedMutation } from "./protocol";
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
