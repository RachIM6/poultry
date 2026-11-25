import { v7 as uuidv7 } from "uuid";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, farmDayOf, latestRecordableDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { farmBelongsTo, farmsWithHouses, houseOf, listLegalEntities, placeNames, type LegalEntityDto } from "@/modules/farm-registry";
import { postEntry, type PostError } from "@/modules/finance/application/ledger";
import {
  acquisitionPosting,
  assetCost,
  assetPaymentPosting,
  ASSET_ACCOUNTS,
  ASSET_DEBTS,
  assetDebtAccount,
  checkAsset,
  disposalPostings,
  LONG_TERM_ASSET_DEBTS,
  straightLine,
  treasuryKindOf,
  yearEndDepreciation,
  type AssetCategory,
  type AssetError,
  type AssetPaidWith,
  type DepreciableAsset,
  type ScheduleYear,
} from "@/modules/finance/domain/assets";
import { chartOf } from "@/modules/finance/domain/chart";
import { fiscalYearOf } from "@/modules/finance/domain/entry";
import { inChart, type Posting } from "@/modules/finance/domain/posting";
import { ledgerAccounts, sourceAlreadyPosted } from "@/modules/finance/infrastructure/ledger";
import { FixedAssetDisposal, FixedAssetInput, FixedAssetPayment, FixedAssetUpdate } from "@/modules/finance/schema";
import type { FixedAsset } from "@/generated/prisma/client";

export type AssetWriteError =
  | AssetError
  | PostError
  | "DAY_IN_FUTURE"
  | "CASH_BOOK_NO_PAYMENT"
  | "ALREADY_DISPOSED"
  | "DISPOSAL_BEFORE_IN_SERVICE"
  | "PAID_MORE_THAN_OWED"
  | "FILE_ALREADY_ATTACHED";

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10) as FarmDay;
const inFuture = (day: string, clock: Clock) => daysBetween(day as FarmDay, latestRecordableDay(clock)) < 0;
const acquisitionSource = (id: string) => `asset:${id}:acq`;
const paymentSource = (id: string, paymentId: string) => `asset:${id}:pay:${paymentId}`;
const disposalSource = (id: string) => `asset:${id}:disposal`; // versions 1–3: depreciation, exit, price

export const facts = (r: FixedAsset): DepreciableAsset => ({
  cost: r.costCentimes,
  residual: r.residualCentimes,
  lifeMonths: r.lifeMonths,
  inServiceOn: dayOf(r.inServiceOn),
  disposedOn: r.disposedOn && dayOf(r.disposedOn),
  opening: r.openingOn && { on: dayOf(r.openingOn), accumulated: r.openingAccumulatedCentimes },
});
/** FQ19: an entity's fixed assets with their category and place, for `depreciationShares` (FC4, FC6). */
export const placedAssets = async (tx: Tx, ctx: TenantContext, legalEntityId: string) =>
  (await tx.fixedAsset.findMany({ where: { organizationId: ctx.organizationId, legalEntityId } })).map((a) => ({ ...facts(a), category: a.category as AssetCategory, farmId: a.farmId, houseId: a.houseId }));
const audited = (r: Pick<FixedAsset, "lifeMonths" | "residualCentimes">) => ({ lifeMonths: r.lifeMonths, residualCentimes: String(r.residualCentimes) });
/** FQ23: the account an asset bought on credit is owed on, 4481 or 1486, by its last payment day. */
const debtOf = (r: Pick<FixedAsset, "acquiredOn" | "lastPaymentOn">) => assetDebtAccount(dayOf(r.acquiredOn), r.lastPaymentOn && dayOf(r.lastPaymentOn));

// A refused step rolls back what the transaction already wrote (a disposal posts up to three entries).
const REFUSED = Symbol("refused");
async function atomically<T, E extends string>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
  const outcome: { refused?: Result<T, E> } = {};
  try {
    return await db.$transaction(async (tx) => {
      const r = await work(tx);
      if (r.ok) return r;
      outcome.refused = r;
      throw REFUSED;
    });
  } catch (e) {
    if (e === REFUSED && outcome.refused) return outcome.refused;
    throw e;
  }
}

/** ponytail: one legal entity per organisation in M1 (onboarding). */
async function entityOf(ctx: TenantContext): Promise<Result<LegalEntityDto, "NOT_FOUND">> {
  const [entity] = await listLegalEntities(ctx);
  return entity ? ok(entity) : fail("NOT_FOUND");
}

/**
 * Posts a rule's entry in the entity's chart (PCA off → FN2's CGNC accounts), dated by its author: a locked month
 * refuses it. FCX4: a `cash_book` entity keeps the register and the schedules only, so it posts nothing (FQ27: where
 * its cash or bank payment for an asset goes in the cash book).
 */
async function post(tx: Tx, ctx: TenantContext, entity: LegalEntityDto, source: string, version: number, day: FarmDay, rule: Posting): Promise<Result<void, PostError>> {
  if (entity.accountingProfile.books !== "ledger") return ok(undefined);
  const all = await ledgerAccounts(tx);
  const posting = inChart(rule, chartOf(all, "cgnc", ["pca"]), chartOf(all, entity.accountingProfile.base, entity.accountingProfile.overlays));
  if (!posting) throw new Error(`${source}: an account has no home in this chart`); // a rule bug: accounts.test.ts
  return postEntry(tx, ctx, { id: uuidv7(), legalEntityId: entity.id, journal: posting.journal, day, label: posting.label, reversesId: null, lines: posting.lines, source: { module: "finance", id: source, version } });
}

/** FN3: the organisation's cash box for cash, bank account otherwise; none named is allowed, as for an expense. */
async function treasuryFits(tx: Tx, ctx: TenantContext, id: string | null, kind: "cash" | "bank"): Promise<Result<void, "NOT_FOUND" | "INVALID_INPUT">> {
  if (!id) return ok(undefined);
  const account = await tx.treasuryAccount.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { kind: true } });
  if (!account) return fail("NOT_FOUND");
  return account.kind === kind ? ok(undefined) : fail("INVALID_INPUT");
}

const lockAsset = async (tx: Tx, ctx: TenantContext, id: string) => {
  await tx.$executeRaw`SELECT 1 FROM "FixedAsset" WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
  return tx.fixedAsset.findFirst({ where: { id, organizationId: ctx.organizationId } });
};

/**
 * SPEC-finance FC1: the owner registers an asset. Acquired: posts D the asset account (+ 34551) / C 5161, 5141, or on
 * credit 4481, or 1486 when its last payment day is more than 12 months away (FQ23), on its day, source
 * `asset:<id>:acq`. In the opening balance: posts nothing, the opening entry carries it (FCX3). The id comes from the
 * form: the same form twice registers and posts once. A `cash_book` entity: the register only.
 */
export async function createFixedAsset(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, AssetWriteError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = FixedAssetInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const a = parsed.data;
  const opening = a.opening && { on: a.opening.on as FarmDay, accumulated: BigInt(a.opening.accumulatedCentimes) };
  if ((a.paidWith === null) === (opening === null)) return fail("INVALID_INPUT"); // paid somehow, or in the opening balance
  if (a.lastPaymentOn && (a.paidWith !== "credit" || a.lastPaymentOn < a.acquiredOn)) return fail("INVALID_INPUT"); // FQ23: a credit's term
  if (inFuture(a.acquiredOn, clock) || (opening && inFuture(opening.on, clock))) return fail("DAY_IN_FUTURE");
  const entity = await entityOf(ctx);
  if (!entity.ok) return entity;
  const [amount, vat, residual] = [BigInt(a.amountCentimes), BigInt(a.vatCentimes), BigInt(a.residualCentimes)];
  const cost = assetCost(amount, vat, entity.value.vatRegistered); // frozen: a later VAT registration doesn't move it
  const asset = { category: a.category, acquiredOn: a.acquiredOn as FarmDay, inServiceOn: a.inServiceOn as FarmDay, amount, vat, cost, residual, lifeMonths: a.lifeMonths, disposedOn: null, opening };
  const checked = checkAsset(asset);
  if (!checked.ok) return checked;
  const category = a.category as AssetCategory;

  return atomically(async (tx): Promise<Result<void, AssetWriteError>> => {
    const prior = await tx.fixedAsset.findUnique({ where: { id: a.id }, select: { organizationId: true } });
    if (prior) return prior.organizationId === ctx.organizationId ? ok(undefined) : fail("ALREADY_EXISTS"); // a retry
    let farmId = a.farmId;
    if (a.houseId) {
      const house = await houseOf(tx, ctx, a.houseId);
      if (!house || (farmId && farmId !== house.farmId)) return fail("NOT_FOUND");
      farmId = house.farmId;
    } else if (farmId && !(await farmBelongsTo(tx, ctx, farmId))) return fail("NOT_FOUND");
    const paidWith = a.paidWith as AssetPaidWith | null;
    const treasuryId = paidWith && paidWith !== "credit" ? a.treasuryId : null;
    if (paidWith) {
      if (paidWith !== "credit") {
        const fits = await treasuryFits(tx, ctx, treasuryId, treasuryKindOf(paidWith));
        if (!fits.ok) return fits;
      }
      const debt = assetDebtAccount(asset.acquiredOn, a.lastPaymentOn as FarmDay | null);
      const posted = await post(tx, ctx, entity.value, acquisitionSource(a.id), 1, asset.acquiredOn, acquisitionPosting({ category, label: a.label, cost, amount, paidWith, treasuryId }, debt));
      if (!posted.ok) return posted;
    }
    await tx.fixedAsset.create({
      data: {
        id: a.id,
        organizationId: ctx.organizationId,
        legalEntityId: entity.value.id,
        label: a.label,
        category,
        farmId,
        houseId: a.houseId,
        acquiredOn: date(a.acquiredOn),
        inServiceOn: date(a.inServiceOn),
        amountCentimes: amount,
        vatCentimes: vat,
        costCentimes: cost,
        residualCentimes: residual,
        lifeMonths: a.lifeMonths,
        paidWith,
        lastPaymentOn: a.lastPaymentOn ? date(a.lastPaymentOn) : null,
        openingOn: opening && date(opening.on),
        openingAccumulatedCentimes: opening?.accumulated ?? 0n,
        createdBy: ctx.userId,
      },
    });
    const after = { ...a, costCentimes: String(cost), paidWith, treasuryId, farmId };
    await audit(tx, ctx, { entity: "FixedAsset", entityId: a.id, action: "create", after }); // the entry: postEntry's audit
    return ok(undefined);
  });
}

/**
 * FC1: once registered, only the life and the residual value change (the depreciation is posted by the close run,
 * T103, which reverses what changed). Cost, VAT and payment stay as posted; a disposed asset no longer changes.
 */
export async function updateFixedAsset(ctx: TenantContext, input: unknown): Promise<Result<void, AssetWriteError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = FixedAssetUpdate.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { assetId, lifeMonths } = parsed.data;
  const residual = BigInt(parsed.data.residualCentimes);
  return atomically(async (tx): Promise<Result<void, AssetWriteError>> => {
    const row = await lockAsset(tx, ctx, assetId);
    if (!row) return fail("NOT_FOUND");
    if (row.disposedOn) return fail("ALREADY_DISPOSED");
    const checked = checkAsset({ ...facts(row), category: row.category, acquiredOn: dayOf(row.acquiredOn), amount: row.amountCentimes, vat: row.vatCentimes, lifeMonths, residual });
    if (!checked.ok) return checked;
    await tx.fixedAsset.update({ where: { id: row.id }, data: { lifeMonths, residualCentimes: residual } });
    await audit(tx, ctx, { entity: "FixedAsset", entityId: row.id, action: "update", before: audited(row), after: audited({ lifeMonths, residualCentimes: residual }) });
    return ok(undefined);
  });
}

/** FC1: a later payment of an asset bought on credit, D 4481 or 1486 (the account it is owed on, FQ23) / C 5161 or 5141, at most what is still owed. */
export async function payFixedAsset(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, AssetWriteError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = FixedAssetPayment.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const p = parsed.data;
  if (inFuture(p.day, clock)) return fail("DAY_IN_FUTURE");
  const entity = await entityOf(ctx);
  if (!entity.ok) return entity;
  if (entity.value.accountingProfile.books !== "ledger") return fail("CASH_BOOK_NO_PAYMENT"); // no 4481 to pay off
  return atomically(async (tx): Promise<Result<void, AssetWriteError>> => {
    const row = await lockAsset(tx, ctx, p.assetId); // two payments at once: one after the other
    if (!row) return fail("NOT_FOUND");
    if (row.paidWith !== "credit") return fail("INVALID_INPUT");
    const source = paymentSource(row.id, p.id);
    if (await sourceAlreadyPosted(tx, ctx, { module: "finance", id: source, version: 1 })) return ok(undefined); // a retry
    const amount = BigInt(p.amountCentimes);
    if (amount > (await owedOn(tx, ctx, [row.id])).get(row.id)!) return fail("PAID_MORE_THAN_OWED");
    const fits = await treasuryFits(tx, ctx, p.treasuryId, treasuryKindOf(p.paidWith));
    if (!fits.ok) return fits;
    const posted = await post(tx, ctx, entity.value, source, 1, p.day as FarmDay, assetPaymentPosting(row.label, amount, p.paidWith, p.treasuryId, debtOf(row)));
    if (!posted.ok) return posted;
    await audit(tx, ctx, { entity: "FixedAsset", entityId: row.id, action: "pay", after: { paymentId: p.id, day: p.day, amountCentimes: p.amountCentimes, paidWith: p.paidWith, treasuryId: p.treasuryId } });
    return ok(undefined);
  });
}

/** F-Effects: what each asset bought on credit still owes on 4481 or 1486 (`payFixedAsset`'s cap), due on its acquisition day. */
export async function assetDues(ctx: TenantContext): Promise<{ dueOn: string; amountCentimes: bigint }[]> {
  const rows = await db.fixedAsset.findMany({ where: { organizationId: ctx.organizationId, paidWith: "credit" }, select: { id: true, acquiredOn: true } });
  const owed = await owedOn(db, ctx, rows.map((r) => r.id));
  return rows.flatMap((r) => (owed.get(r.id)! > 0n ? [{ dueOn: dayOf(r.acquiredOn), amountCentimes: owed.get(r.id)! }] : []));
}

/** What is still owed on 4481 or 1486 (FQ23) for each asset: its acquisition's credit less its payments. */
const DEBTS = [ASSET_DEBTS, LONG_TERM_ASSET_DEBTS];
async function owedOn(tx: Tx, ctx: TenantContext, ids: string[]): Promise<Map<string, bigint>> {
  const lines = await tx.journalLine.findMany({
    where: { organizationId: ctx.organizationId, account: { in: DEBTS }, entry: { sourceModule: "finance", sourceId: { in: ids.map(acquisitionSource) } } },
    select: { creditCentimes: true, entry: { select: { sourceId: true } } },
  });
  const payments = await tx.journalLine.findMany({
    where: { organizationId: ctx.organizationId, account: { in: DEBTS }, entry: { sourceModule: "finance", OR: ids.map((id) => ({ sourceId: { startsWith: `asset:${id}:pay:` } })) } },
    select: { debitCentimes: true, entry: { select: { sourceId: true } } },
  });
  const owed = new Map(ids.map((id) => [id, 0n]));
  const idOf = (source: string | null) => source!.split(":")[1];
  for (const l of lines) owed.set(idOf(l.entry.sourceId), owed.get(idOf(l.entry.sourceId))! + l.creditCentimes);
  for (const l of payments) owed.set(idOf(l.entry.sourceId), owed.get(idOf(l.entry.sourceId))! - l.debitCentimes);
  return owed;
}

/**
 * FC1: sold or scrapped. On its day (OD): the depreciation of the fiscal year up to the disposal month, the asset
 * leaving at its cost, and the price on 7513, source `asset:<id>:disposal`. The close run (T103) leaves that year's
 * months out: `ScheduleYear.toDisposal`. A locked month refuses it (T101), nothing posted.
 */
export async function disposeFixedAsset(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, AssetWriteError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = FixedAssetDisposal.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const d = parsed.data;
  const [day, price] = [d.day as FarmDay, BigInt(d.priceCentimes)];
  if (inFuture(day, clock)) return fail("DAY_IN_FUTURE");
  const entity = await entityOf(ctx);
  if (!entity.ok) return entity;
  return atomically(async (tx): Promise<Result<void, AssetWriteError>> => {
    const row = await lockAsset(tx, ctx, d.assetId);
    if (!row) return fail("NOT_FOUND");
    if (row.disposedOn) return dayOf(row.disposedOn) === day && row.disposalPriceCentimes === price ? ok(undefined) : fail("ALREADY_DISPOSED"); // a retry
    if (day < dayOf(row.inServiceOn) || (row.openingOn && day < dayOf(row.openingOn))) return fail("DISPOSAL_BEFORE_IN_SERVICE");
    const treasuryId = price > 0n ? d.treasuryId : null;
    const fits = await treasuryFits(tx, ctx, treasuryId, d.receivedIn);
    if (!fits.ok) return fits;
    const asset = { ...facts(row), disposedOn: day, category: row.category as AssetCategory, label: row.label, amount: row.amountCentimes };
    for (const { version, posting } of disposalPostings(asset, price, d.receivedIn, treasuryId, entity.value.fiscalYearStartMonth)) {
      const posted = await post(tx, ctx, entity.value, disposalSource(row.id), version, day, posting);
      if (!posted.ok) return posted;
    }
    await tx.fixedAsset.update({ where: { id: row.id }, data: { disposedOn: date(day), disposalPriceCentimes: price } });
    await audit(tx, ctx, { entity: "FixedAsset", entityId: row.id, action: "dispose", after: { day, priceCentimes: d.priceCentimes, receivedIn: d.receivedIn, treasuryId } });
    return ok(undefined);
  });
}

/** FC1, FCX4: the close run's depreciation kind for the fiscal year starting on `yearFrom` (T103), in the rule's accounts. */
export async function closeDepreciation(tx: Tx, ctx: TenantContext, legalEntityId: string, yearFrom: FarmDay, fiscalYearStartMonth: number): Promise<Posting | null> {
  const rows = await tx.fixedAsset.findMany({ where: { organizationId: ctx.organizationId, legalEntityId } });
  return yearEndDepreciation(rows.map((r) => ({ ...facts(r), category: r.category as AssetCategory })), yearFrom, fiscalYearStartMonth);
}

/** ADR-011: the invoice the upload route has just stored, attached once to the owner's asset. */
export async function attachFixedAssetReceipt(ctx: TenantContext, assetId: string, fileId: string, inTx?: Tx): Promise<Result<void>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const attach = async (tx: Tx) => {
    // Conditional update: of two uploads at once, only the first attaches.
    const { count } = await tx.fixedAsset.updateMany({ where: { id: assetId, organizationId: ctx.organizationId, receiptFileId: null }, data: { receiptFileId: fileId } });
    if (count === 0) return (await tx.fixedAsset.count({ where: { id: assetId, organizationId: ctx.organizationId } })) ? fail("FILE_ALREADY_ATTACHED") : fail("NOT_FOUND");
    await audit(tx, ctx, { entity: "FixedAsset", entityId: assetId, action: "update", before: { receiptFileId: null }, after: { receiptFileId: fileId } });
    return ok(undefined);
  };
  return inTx ? attach(inTx) : db.$transaction(attach); // inTx: the upload's own transaction
}

export type AssetView = {
  id: string;
  label: string;
  category: AssetCategory;
  account: string; // the asset account of the category (PCA; FN2 fallback with the PCA off)
  place: string | null; // farm, or "farm · house"
  acquiredOn: string;
  inServiceOn: string;
  cost: bigint;
  vat: bigint;
  residual: bigint;
  lifeMonths: number | null;
  paidWith: AssetPaidWith | null; // null: in the opening balance
  lastPaymentOn: string | null; // FQ23: bought on credit, its last payment day as typed
  debtAccount: string | null; // FQ23: bought on credit, 4481 or 1486
  opening: { on: string; accumulated: bigint } | null;
  disposedOn: string | null;
  disposalPrice: bigint | null;
  receiptFileId: string | null;
  owed: bigint; // still due on 4481 or 1486, bought on credit
  accumulated: bigint; // at the end of the current fiscal year, or at the disposal
  schedule: ScheduleYear[];
};

export type AssetRegister = {
  books: "cash_book" | "ledger";
  fiscalYear: { from: FarmDay; to: FarmDay };
  assets: AssetView[];
  // The owner's forms only:
  farms?: { id: string; name: string; houses: { id: string; name: string }[] }[];
  treasury?: { id: string; kind: "cash" | "bank"; name: string }[];
};

/** FC1 "Immobilisations": each asset with its schedule by year. The owner writes; the manager and the accountant read. */
export async function assetRegister(ctx: TenantContext, clock: Clock = systemClock): Promise<Result<AssetRegister, "FORBIDDEN" | "NOT_FOUND">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // workers never see money (FX2)
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  const fiscalYear = fiscalYearOf(farmDayOf(clock.now()), entity.fiscalYearStartMonth);
  const rows = await db.fixedAsset.findMany({ where: { organizationId: ctx.organizationId, legalEntityId: entity.id }, orderBy: [{ acquiredOn: "asc" }, { label: "asc" }] });
  const [owed, names] = await Promise.all([owedOn(db, ctx, rows.map((r) => r.id)), placeNames(db, ctx, rows.flatMap((r) => [r.farmId, r.houseId].filter((x) => x !== null)))]);
  const assets = rows.map((r): AssetView => {
    const f = facts(r);
    const schedule = straightLine(f, entity.fiscalYearStartMonth);
    const category = r.category as AssetCategory;
    return {
      id: r.id,
      label: r.label,
      category,
      account: ASSET_ACCOUNTS[category].asset,
      place: [r.farmId, r.houseId].flatMap((id) => (id && names.get(id) ? [names.get(id)!] : [])).join(" · ") || null,
      acquiredOn: dayOf(r.acquiredOn),
      inServiceOn: f.inServiceOn,
      cost: r.costCentimes,
      vat: r.vatCentimes,
      residual: r.residualCentimes,
      lifeMonths: r.lifeMonths,
      paidWith: r.paidWith as AssetPaidWith | null,
      lastPaymentOn: r.lastPaymentOn && dayOf(r.lastPaymentOn),
      debtAccount: r.paidWith === "credit" ? debtOf(r) : null,
      opening: f.opening,
      disposedOn: f.disposedOn,
      disposalPrice: r.disposalPriceCentimes,
      receiptFileId: r.receiptFileId,
      owed: owed.get(r.id) ?? 0n,
      accumulated: schedule.findLast((y) => y.from <= fiscalYear.to)?.accumulated ?? f.opening?.accumulated ?? 0n,
      schedule,
    };
  });
  if (!can(ctx, "finance.manage")) return ok({ books: entity.accountingProfile.books, fiscalYear, assets });
  const [farms, treasury] = await Promise.all([
    farmsWithHouses(ctx),
    db.treasuryAccount.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, kind: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return ok({ books: entity.accountingProfile.books, fiscalYear, assets, farms, treasury: treasury.map((t) => ({ ...t, kind: t.kind as "cash" | "bank" })) });
}
