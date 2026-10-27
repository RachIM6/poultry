# Tactical patterns: TypeScript templates (Next.js + Prisma + offline)

Adapted from the `cdoc-ddd` templates. There is no NestJS here, so there are no DI containers, decorators or `Symbol` tokens. Dependencies are passed as plain function arguments. Check the installed Next.js docs (`node_modules/next/dist/docs/`) before writing server actions or route handlers.

## Contents

1. Shared kernel (Result, Clock, FarmDay, branded ids, integers)
2. Value object
3. Aggregate with transition table (Batch)
4. Pure domain function used on both sides (withdrawal)
5. Repository + mapper (Prisma)
6. Use case with tenant context, transaction and audit
7. Mutation schema and sync apply
8. Server action / route handler
9. Testing

---

## 1. Shared kernel (`src/lib/kernel/`)

`src/lib` must not import modules. The kernel is generic.

```ts
// result.ts
export type Result<T, E extends string = string> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = <E extends string>(error: E): Result<never, E> => ({ ok: false, error });
```

```ts
// clock.ts: the only place allowed to read the system time
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });
```

```ts
// farm-day.ts: a calendar day on the farm, in Africa/Casablanca (DST around Ramadan)
export type FarmDay = string & { readonly __brand: 'FarmDay' }; // 'YYYY-MM-DD'

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }); // en-CA → YYYY-MM-DD
export const farmDayOf = (instant: Date) => fmt.format(instant) as FarmDay;

export function addDays(day: FarmDay, n: number): FarmDay {
  const d = new Date(`${day}T00:00:00Z`); // calendar arithmetic only, no time zone involved
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10) as FarmDay;
}

export const daysBetween = (from: FarmDay, to: FarmDay) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
```

```ts
// ids.ts
export type BatchId = string & { readonly __brand: 'BatchId' };
export type OrganizationId = string & { readonly __brand: 'OrganizationId' };
// generated on the client with uuidv7 (ADR-003); validated as z.uuid() at the boundary

// quantities.ts
export type Centimes = bigint & { readonly __brand: 'Centimes' };
export type Grams = number & { readonly __brand: 'Grams' }; // safe integers up to 9e15 g
```

## 2. Value object

```ts
// src/modules/identity/domain/phone-number.ts
export class PhoneNumber {
  private constructor(public readonly e164: string) {}
  /** Moroccan mobile numbers only: 06…, 07…, +2126…, +2127… */
  static create(raw: string): Result<PhoneNumber, 'INVALID_PHONE'> {
    const digits = raw.replace(/[\s.-]/g, '');
    const m = /^(?:\+212|00212|0)([67]\d{8})$/.exec(digits);
    return m ? ok(new PhoneNumber(`+212${m[1]}`)) : fail('INVALID_PHONE');
  }
  equals(o: PhoneNumber) {
    return this.e164 === o.e164;
  }
}
```

## 3. Aggregate with transition table

```ts
// src/modules/flock/domain/batch.ts
export type BatchStatus = 'OPEN' | 'CLOSED';
const TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = { OPEN: ['CLOSED'], CLOSED: [] };

export class Batch {
  private constructor(
    readonly id: BatchId,
    readonly houseId: HouseId,
    readonly placedOn: FarmDay,
    readonly chicksPlaced: number,
    private _status: BatchStatus,
    private _days: Map<FarmDay, DailyEntry>,
    private _birdsOut: number, // dead + culled + sold
  ) {}

  static rehydrate(p: BatchProps) { /* mapper only */ }

  get birdsOnHand() {
    return this.chicksPlaced - this._birdsOut;
  }

  recordDay(day: FarmDay, entry: DailyEntryInput): Result<DailyEntry, 'BATCH_CLOSED' | 'DAY_BEFORE_PLACEMENT' | 'MORE_DEAD_THAN_ON_HAND'> {
    if (this._status !== 'OPEN') return fail('BATCH_CLOSED');
    if (day < this.placedOn) return fail('DAY_BEFORE_PLACEMENT');
    const previous = this._days.get(day);
    const delta = entry.dead + entry.culled - (previous ? previous.dead + previous.culled : 0);
    if (delta > this.birdsOnHand) return fail('MORE_DEAD_THAN_ON_HAND');
    const merged = DailyEntry.merge(previous, entry); // same day from two devices: last write wins per field
    this._days.set(day, merged);
    this._birdsOut += delta;
    return ok(merged);
  }

  close(reason: CloseReason): Result<void, 'INVALID_TRANSITION'> {
    if (!TRANSITIONS[this._status].includes('CLOSED')) return fail('INVALID_TRANSITION');
    this._status = 'CLOSED';
    return ok(undefined);
  }
}
```

## 4. Pure domain function used on both sides

```ts
// src/modules/health/domain/withdrawal.ts: imported by the offline client AND the sales use case (via health/index.ts)
export interface TreatmentForWithdrawal {
  endDay: FarmDay;
  withdrawalDays: number; // from the product in reference data, never hardcoded
}

/** Last farm day of the withdrawal period, or null when none applies. The latest end wins. */
export function withdrawalEnd(treatments: readonly TreatmentForWithdrawal[]): FarmDay | null {
  return treatments.reduce<FarmDay | null>((latest, t) => {
    const end = addDays(t.endDay, t.withdrawalDays);
    return latest === null || end > latest ? end : latest;
  }, null);
}

export const inWithdrawal = (today: FarmDay, end: FarmDay | null) => end !== null && today <= end;
```

## 5. Repository + mapper

```ts
// src/modules/flock/infrastructure/batch.repository.ts
export function batchRepository(tx: Tx) {
  return {
    async findById(ctx: TenantContext, id: BatchId) {
      const row = await tx.batch.findFirst({
        where: { id, organizationId: ctx.organizationId }, // tenant scope on every query
        include: { days: true },
      });
      return row ? BatchMapper.toDomain(row) : null;
    },
    async findOpenByHouse(ctx: TenantContext, houseId: HouseId) { /* … */ },
    async save(ctx: TenantContext, b: Batch) {
      await tx.batch.upsert(BatchMapper.toPersistence(ctx, b));
    },
  };
}
```

## 6. Use case

```ts
// src/modules/flock/application/record-day.ts
export async function recordDay(
  deps: { db: Db; clock: Clock },
  ctx: TenantContext,
  cmd: RecordDayCommand, // already validated by schema.ts
) {
  if (!can(ctx, 'flock.recordDay')) return fail('FORBIDDEN');
  return deps.db.$transaction(async (tx) => {
    const batches = batchRepository(tx);
    const batch = await batches.findById(ctx, cmd.batchId);
    if (!batch) return fail('NOT_FOUND');

    const before = batch.snapshotDay(cmd.day);
    const result = batch.recordDay(cmd.day, cmd.entry);
    if (!result.ok) return result;

    await batches.save(ctx, batch);
    if (cmd.entry.feed) {
      await inventory.recordConsumption(ctx, tx, {
        sourceId: result.value.id, // one movement per entry: upsert, never duplicate
        itemId: cmd.entry.feed.itemId,
        grams: cmd.entry.feed.grams,
        day: cmd.day,
      });
    }
    await audit(tx, ctx, {
      entity: 'DailyEntry',
      entityId: result.value.id,
      action: before ? 'update' : 'create',
      before,
      after: result.value,
      mutationId: cmd.mutationId,
      deviceCreatedAt: cmd.deviceCreatedAt,
      serverReceivedAt: deps.clock.now(),
    });
    return ok(toDailyEntryDto(ctx, result.value));
  });
}
```

## 7. Mutation schema and sync apply

```ts
// src/modules/flock/schema.ts: imported by the client (Dexie write) and the server (sync push)
export const RecordDay = z.object({
  batchId: z.uuid(),
  day: z.iso.date(),
  entry: z.object({
    dead: z.int().min(0),
    culled: z.int().min(0),
    deathCause: z.enum(DEATH_CAUSES).optional(),
    feed: z.object({ itemId: z.uuid(), grams: z.int().min(0) }).optional(),
    waterMl: z.int().min(0).optional(),
    note: z.string().max(500).optional(),
  }),
});
export const flockMutations = { 'flock.recordDay': RecordDay } as const;
```

```ts
// src/lib/sync/server.ts (sketch): idempotent apply
for (const m of batch) {
  const done = await db.mutation.findUnique({ where: { id: m.id } });
  if (done) { results.push(done.result); continue; } // replay → same result
  const handler = registry[m.type]; // built from each module's index.ts
  const parsed = handler.schema.safeParse(m.payload);
  const result = parsed.success
    ? await handler.apply(deps, ctx, { ...parsed.data, mutationId: m.id, deviceCreatedAt: m.createdAt })
    : fail('INVALID_PAYLOAD');
  await db.mutation.create({ data: { id: m.id, organizationId: ctx.organizationId, result } });
  results.push(result);
}
```

## 8. Server action / route handler

- Pages and server actions call the module's `index.ts` only.
- Server actions get Next's built-in Origin vs Host check (see `node_modules/next/dist/docs/01-app/02-guides/data-security.md`). Route handlers need the CSRF check from `poultry-auth`.
- Map `Result` errors to `{ ok: false, messageKey: 'errors.<CODE>' }`. Never send raw error strings.

## 9. Testing

- **Domain:** plain Vitest with `fixedClock` and literal `FarmDay`s. Cover every invariant and every allowed / forbidden transition. These tests also cover the offline client, since it runs the same functions.
- **Repositories, use cases, sync:** integration tests against real Postgres (test database, reset per file). They must cover:
  - tenant isolation (organisation A cannot read or write B's data);
  - idempotency (the same mutation twice → one effect);
  - uniqueness conflicts → `rejected`.
- **Use-case orchestration only:** in-memory fakes are fine. Never use fakes to test persistence.
- **E2E:** Playwright on a mobile viewport, in `ar` and `fr`, with `context.setOffline(true)` segments.
