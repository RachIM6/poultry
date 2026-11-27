import type { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db, SYNC_TX, type Tx } from "@/lib/db";
import type { Result } from "@/lib/kernel/result";
import { can, type Action } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { PULL_PAGE, SCOPE_HEADER, type MutationResult, type PullResponse, type PushedMutation, type PushResponse } from "./protocol";

/**
 * One offline write, declared by its module (poultry-ddd §5). `apply` validates and decides before it writes: a
 * rejection is recorded in the same transaction, so writes made before returning `fail` would be kept. A refusal that
 * comes after writes (two modules chained in the app layer) throws `Rejection` instead.
 */
export type MutationHandler<P> = {
  schema: z.ZodType<P>;
  action: Action; // checked with can() before apply
  apply(tx: Tx, ctx: TenantContext, payload: P, meta: { mutationId: string; deviceCreatedAt: Date }): Promise<Result<void>>;
};

/** Built in the app layer from module indexes (src/lib may not import modules). */
export type SyncRegistry = {
  mutations: Record<string, MutationHandler<never>>;
  /**
   * Per synced entity: what a caller may see of a record (money stripped for workers), or undefined when the record
   * isn't theirs to see at all (another user's notification). Unlisted entities never leave.
   */
  entities: Record<string, (ctx: TenantContext, data: never) => unknown>;
  /** ADR-013: for a role listed here (partners), only these entities leave; a role not listed keeps `entities` alone. */
  views?: Partial<Record<TenantContext["role"], readonly string[]>>;
};

export const scopeMatches = (req: Request, ctx: TenantContext) => req.headers.get(SCOPE_HEADER) === `${ctx.userId}:${ctx.organizationId}`;

/** A business refusal after writes: its transaction rolls back, then it is recorded as rejected, so a replay gives it again. */
export class Rejection extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Keeps the payload type between schema and apply, then erases it for the registry. */
export const defineMutation = <P>(handler: MutationHandler<P>) => handler as unknown as MutationHandler<never>;

/**
 * Records a change to a synced record for pull, inside the module's transaction. `data: null` is a deletion.
 * The counter row stays locked until commit, so versions become visible in order and a pull never skips one.
 */
// ponytail: one counter row per organisation serializes its writes; fine for farm-sized traffic.
export async function recordChange(tx: Tx, ctx: Pick<TenantContext, "organizationId">, entity: string, entityId: string, data: object | null) {
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

/**
 * A uniqueness violation the handler didn't check for (poultry-ddd §5: a rejection, never a 500) rolls its transaction
 * back. Tried once more, in case a concurrent write won a race the retry now sees; a second one is the mutation's own,
 * so it is recorded as rejected instead of holding the phone's outbox forever.
 */
function applyOnce(ctx: TenantContext, m: PushedMutation, registry: SyncRegistry): Promise<MutationResult> {
  const attempt = () => claimed(ctx, m, (tx) => decide(tx, ctx, m, registry));
  return attempt()
    .catch((error) => (isTakenKey(error) ? attempt() : Promise.reject(error)))
    .catch((error) => (isTakenKey(error) ? claimed(ctx, m, async () => rejected("ALREADY_EXISTS")) : Promise.reject(error)))
    .catch((error) => (error instanceof Rejection ? claimed(ctx, m, async () => rejected(error.code)) : Promise.reject(error)));
}

const isTakenKey = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

function claimed(ctx: TenantContext, m: PushedMutation, decide: (tx: Tx) => Promise<MutationResult>): Promise<MutationResult> {
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
    const result = await decide(tx);
    await tx.mutation.update({ where: { id: m.id }, data: { result } });
    return result;
  }, SYNC_TX);
}

/** One mutation checked and applied in `tx`, as push does it (src/ops/demo batches many to a transaction). */
export async function decide(tx: Tx, ctx: TenantContext, m: PushedMutation, registry: SyncRegistry): Promise<MutationResult> {
  const handler = Object.hasOwn(registry.mutations, m.type) ? registry.mutations[m.type] : undefined;
  if (ctx.leftAt) return rejected("ORGANIZATION_LEFT"); // read-only once it left (docs/data-requests.md)
  if (!handler) return rejected("UNKNOWN_MUTATION");
  if (!can(ctx, handler.action)) return rejected("FORBIDDEN"); // re-checked against today's role (poultry-auth §0.5)
  const payload = handler.schema.safeParse(m.payload);
  if (!payload.success) return rejected("INVALID_INPUT");
  const outcome = await handler.apply(tx, ctx, payload.data, { mutationId: m.id, deviceCreatedAt: new Date(m.createdAt) });
  if (outcome.ok) return { status: "applied" };
  // A failure's own fields become its message values; a list arrives comma-joined (V6: the days to discard first).
  const extra = Object.entries(outcome).filter(([k]) => k !== "ok" && k !== "error");
  return rejected(outcome.error, Object.fromEntries(extra.map(([k, v]) => [k, typeof v === "number" ? v : String(v)])));
}

const rejected = (code: string, values: Record<string, string | number> = {}): MutationResult => ({
  status: "rejected",
  messageKey: `errors.${code}`,
  ...(Object.keys(values).length > 0 && { messageValues: values }),
});

/**
 * ADR-003 pull, compacted (ADR-014): the caller's organisation only, the latest change of each record changed after the
 * cursor, in version order, a page at a time. `snapshot` from 0 (a phone that replaces its copy) leaves deleted records
 * out. `records` (a refused write's) narrows it to those, deletions included, whatever the cursor.
 */
export async function pull(
  ctx: TenantContext,
  since: number,
  registry: SyncRegistry,
  { snapshot = false, records }: { snapshot?: boolean; records?: { entity: string; id: string }[] } = {},
): Promise<PullResponse> {
  const only = records
    ? Prisma.sql`AND (entity, "entityId") IN (SELECT * FROM unnest(${records.map((r) => r.entity)}::text[], ${records.map((r) => r.id)}::uuid[]))`
    : Prisma.empty;
  const live = snapshot && since === 0 && !records ? Prisma.sql`AND data IS NOT NULL` : Prisma.empty;
  // A later version of the same record makes this one superseded: (organizationId, entity, entityId, version) answers it.
  const rows = await db.$queryRaw<{ entity: string; entityId: string; version: bigint; data: unknown }[]>`
    SELECT entity, "entityId", version, data FROM "Change" c
    WHERE "organizationId" = ${ctx.organizationId}::uuid AND version > ${records ? 0n : BigInt(since)} ${live} ${only}
      AND NOT EXISTS (
        SELECT 1 FROM "Change" l
        WHERE l."organizationId" = c."organizationId" AND l.entity = c.entity AND l."entityId" = c."entityId" AND l.version > c.version)
    ORDER BY version
    LIMIT ${PULL_PAGE}`;
  const view = registry.views?.[ctx.role];
  const changes = rows.flatMap((row) => {
    const serialize = Object.hasOwn(registry.entities, row.entity) ? registry.entities[row.entity] : undefined;
    if (!serialize || (view && !view.includes(row.entity))) return [];
    const data = row.data === null ? null : serialize(ctx, row.data as never);
    if (data === undefined) return [];
    return [{ entity: row.entity, id: row.entityId, version: Number(row.version), data }];
  });
  return { version: rows.length ? Number(rows[rows.length - 1].version) : since, hasMore: rows.length === PULL_PAGE, changes };
}
