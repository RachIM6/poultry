import type { z } from "zod";
import { db, type Tx } from "@/lib/db";
import type { Result } from "@/lib/kernel/result";
import { can, type Action } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { PULL_PAGE, type MutationResult, type PullResponse, type PushedMutation, type PushResponse } from "./protocol";

/**
 * One offline write, declared by its module (poultry-ddd §5). `apply` validates and decides before it writes: a
 * rejection is recorded in the same transaction, so writes made before returning `fail` would be kept.
 */
export type MutationHandler<P> = {
  schema: z.ZodType<P>;
  action: Action; // checked with can() before apply
  apply(tx: Tx, ctx: TenantContext, payload: P, meta: { mutationId: string; deviceCreatedAt: Date }): Promise<Result<void>>;
};

/** Built in the app layer from module indexes (src/lib may not import modules). */
export type SyncRegistry = {
  mutations: Record<string, MutationHandler<never>>;
  /** Per synced entity: what a caller may see of a record (money stripped for workers). Unlisted entities never leave. */
  entities: Record<string, (ctx: TenantContext, data: never) => unknown>;
};

/** Keeps the payload type between schema and apply, then erases it for the registry. */
export const defineMutation = <P>(handler: MutationHandler<P>) => handler as unknown as MutationHandler<never>;

/**
 * Records a change to a synced record for pull, inside the module's transaction. `data: null` is a deletion.
 * The counter row stays locked until commit, so versions become visible in order and a pull never skips one.
 */
// ponytail: one counter row per organisation serializes its writes; fine for farm-sized traffic.
export async function recordChange(tx: Tx, ctx: TenantContext, entity: string, entityId: string, data: object | null) {
  const [{ version }] = await tx.$queryRaw<{ version: bigint }[]>`
    INSERT INTO "SyncVersion" ("organizationId", version) VALUES (${ctx.organizationId}::uuid, 1)
    ON CONFLICT ("organizationId") DO UPDATE SET version = "SyncVersion".version + 1
    RETURNING version`;
  await tx.change.create({ data: { organizationId: ctx.organizationId, version, entity, entityId, data: data ?? undefined } });
}

/** ADR-003 push: in order, each mutation in its own transaction, exactly once per mutation id. */
export async function push(ctx: TenantContext, mutations: PushedMutation[], registry: SyncRegistry): Promise<PushResponse> {
  const results: PushResponse["results"] = [];
  for (const m of mutations) {
    try {
      results.push({ id: m.id, ...(await applyOnce(ctx, m, registry)) });
    } catch (error) {
      // Not a business rejection: nothing was recorded, so the client keeps it (and what follows) and retries.
      console.error(`[sync] ${m.type} failed`, error);
      break;
    }
  }
  return { results };
}

function applyOnce(ctx: TenantContext, m: PushedMutation, registry: SyncRegistry): Promise<MutationResult> {
  return db.$transaction(async (tx) => {
    // Claims the id first: a concurrent push of the same id waits here until this one commits, then sees it.
    const claimed = await tx.$executeRaw`
      INSERT INTO "Mutation" (id, "organizationId", "userId", type, result)
      VALUES (${m.id}::uuid, ${ctx.organizationId}::uuid, ${ctx.userId}::uuid, ${m.type}, '{}'::jsonb)
      ON CONFLICT (id) DO NOTHING`;
    if (claimed === 0) {
      const done = await tx.mutation.findUniqueOrThrow({ where: { id: m.id } });
      // Another organisation's id: never replay its result (or reveal it), never apply.
      return done.organizationId === ctx.organizationId ? (done.result as MutationResult) : rejected("FORBIDDEN");
    }
    const result = await decide(tx, ctx, m, registry);
    await tx.mutation.update({ where: { id: m.id }, data: { result } });
    return result;
  });
}

async function decide(tx: Tx, ctx: TenantContext, m: PushedMutation, registry: SyncRegistry): Promise<MutationResult> {
  const handler = Object.hasOwn(registry.mutations, m.type) ? registry.mutations[m.type] : undefined;
  if (!handler) return rejected("UNKNOWN_MUTATION");
  if (!can(ctx, handler.action)) return rejected("FORBIDDEN"); // re-checked against today's role (poultry-auth §0.5)
  const payload = handler.schema.safeParse(m.payload);
  if (!payload.success) return rejected("INVALID_INPUT");
  const outcome = await handler.apply(tx, ctx, payload.data, { mutationId: m.id, deviceCreatedAt: new Date(m.createdAt) });
  return outcome.ok ? { status: "applied" } : rejected(outcome.error);
}

const rejected = (code: string): MutationResult => ({ status: "rejected", messageKey: `errors.${code}` });

/** ADR-003 pull: the caller's organisation only, after the cursor, in version order, a page at a time. */
export async function pull(ctx: TenantContext, since: number, registry: SyncRegistry): Promise<PullResponse> {
  const rows = await db.change.findMany({
    where: { organizationId: ctx.organizationId, version: { gt: since } },
    orderBy: { version: "asc" },
    take: PULL_PAGE,
  });
  const changes = rows.flatMap((row) => {
    const serialize = Object.hasOwn(registry.entities, row.entity) ? registry.entities[row.entity] : undefined;
    if (!serialize) return [];
    const data = row.data === null ? null : serialize(ctx, row.data as never);
    return [{ entity: row.entity, id: row.entityId, version: Number(row.version), data }];
  });
  return { version: rows.length ? Number(rows[rows.length - 1].version) : since, hasMore: rows.length === PULL_PAGE, changes };
}
