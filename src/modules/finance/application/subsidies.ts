import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { daysBetween, latestRecordableDay, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { facts } from "@/modules/finance/application/assets";
import type { PostError } from "@/modules/finance/application/ledger";
import { post } from "@/modules/finance/application/loans";
import type { AssetCategory } from "@/modules/finance/domain/assets";
import type { Posting } from "@/modules/finance/domain/posting";
import { checkSubsidy, receiptPosting, releaseSchedule, yearEndRelease, type ReleaseYear, type Subsidy as Facts, type SubsidyError } from "@/modules/finance/domain/subsidies";
import { SubsidyInput } from "@/modules/finance/schema";
import type { FixedAsset, Subsidy } from "@/generated/prisma/client";

// SPEC-finance FC2 (T106): investment subsidies, on "Emprunts et subventions" with the loans.

export type SubsidyWriteError = SubsidyError | PostError | "DAY_IN_FUTURE";

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10) as FarmDay;
const inFuture = (day: string, clock: Clock) => daysBetween(day as FarmDay, latestRecordableDay(clock)) < 0;
const receiptSource = (id: string) => `subsidy:${id}:receipt`;
const financed = (a: FixedAsset) => ({ ...facts(a), category: a.category as AssetCategory });
const factsOf = (s: Subsidy & { assets: { asset: FixedAsset }[] }): Facts => ({
  amount: s.amountCentimes,
  receivedOn: dayOf(s.receivedOn),
  inalienableYears: s.inalienableYears,
  assets: s.assets.map((x) => financed(x.asset)),
});

/**
 * FC2, default FQ17: the owner records a subsidy when it is received, on a bank account, with the register's assets it
 * finances (land included, with the years the contract makes it inalienable, if any; refused on no asset). Posts
 * D 5141 / C 1311 on that day (source `subsidy:<id>:receipt`), for a `cash_book` entity too: the money comes in on its
 * bank account (as a loan's, T105). The id comes from the form: the same form twice records one subsidy.
 */
export async function createSubsidy(ctx: TenantContext, input: unknown, clock: Clock = systemClock): Promise<Result<void, SubsidyWriteError>> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = SubsidyInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const s = parsed.data;
  if (inFuture(s.receivedOn, clock)) return fail("DAY_IN_FUTURE");
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1 (onboarding)
  if (!entity) return fail("NOT_FOUND");
  const org = { organizationId: ctx.organizationId };
  return db.$transaction(async (tx): Promise<Result<void, SubsidyWriteError>> => {
    const prior = await tx.subsidy.findUnique({ where: { id: s.id }, select: { organizationId: true } });
    if (prior) return prior.organizationId === ctx.organizationId ? ok(undefined) : fail("ALREADY_EXISTS"); // a retry
    const bank = await tx.treasuryAccount.findFirst({ where: { id: s.treasuryId, ...org }, select: { kind: true } });
    if (!bank) return fail("NOT_FOUND");
    if (bank.kind !== "bank") return fail("INVALID_INPUT"); // FC2: received on a bank account (5141)
    const assets = await tx.fixedAsset.findMany({ where: { id: { in: s.assetIds }, ...org, legalEntityId: entity.id } });
    if (assets.length !== s.assetIds.length) return fail("NOT_FOUND");
    const checked = checkSubsidy(assets.map(financed));
    if (!checked.ok) return checked;
    const amount = BigInt(s.amountCentimes);
    const posted = await post(tx, ctx, entity, receiptSource(s.id), s.receivedOn as FarmDay, receiptPosting(s.label, amount, s.treasuryId));
    if (!posted.ok) return posted; // nothing written yet
    await tx.subsidy.create({
      data: {
        id: s.id,
        ...org,
        legalEntityId: entity.id,
        label: s.label,
        grantor: s.grantor,
        amountCentimes: amount,
        receivedOn: date(s.receivedOn),
        treasuryId: s.treasuryId,
        inalienableYears: s.inalienableYears,
        createdBy: ctx.userId,
        assets: { create: s.assetIds.map((assetId) => ({ assetId, ...org })) },
      },
    });
    await audit(tx, ctx, { entity: "Subsidy", entityId: s.id, action: "create", after: s });
    return ok(undefined);
  });
}

const withAssets = { assets: { include: { asset: true } } } as const;

/** FC2, FCX4: the close run's subsidy kind for the fiscal year, D 1319 / C 7577, in the rule's accounts (T106). */
export async function closeSubsidies(tx: Tx, ctx: TenantContext, legalEntityId: string, year: { from: FarmDay; to: FarmDay }, fiscalYearStartMonth: number): Promise<Posting | null> {
  const rows = await tx.subsidy.findMany({ where: { organizationId: ctx.organizationId, legalEntityId }, include: withAssets });
  return yearEndRelease(rows.map(factsOf), year, fiscalYearStartMonth);
}

export type SubsidyView = { id: string; label: string; grantor: string; amount: bigint; receivedOn: FarmDay; bank: string; inalienableYears: number | null; assets: string[]; years: ReleaseYear[] };
/** `assets`: the register's assets still in service, for the form (land included, FQ17). */
export type SubsidyRegister = { subsidies: SubsidyView[]; assets: { id: string; label: string }[] };

/** FC2 "Emprunts et subventions": each subsidy with its release by year. A read: the accountant too. */
export async function subsidyRegister(ctx: TenantContext): Promise<Result<SubsidyRegister, "FORBIDDEN" | "NOT_FOUND">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN"); // workers never see money (FX2)
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return fail("NOT_FOUND");
  const where = { organizationId: ctx.organizationId, legalEntityId: entity.id };
  const [rows, assets, banks] = await Promise.all([
    db.subsidy.findMany({ where, include: withAssets, orderBy: [{ receivedOn: "asc" }, { label: "asc" }] }),
    db.fixedAsset.findMany({ where: { ...where, disposedOn: null }, select: { id: true, label: true }, orderBy: { label: "asc" } }),
    db.treasuryAccount.findMany({ where: { organizationId: ctx.organizationId, kind: "bank" }, select: { id: true, name: true } }),
  ]);
  const names = new Map(banks.map((b) => [b.id, b.name]));
  return ok({
    subsidies: rows.map((s) => ({
      id: s.id,
      label: s.label,
      grantor: s.grantor,
      amount: s.amountCentimes,
      receivedOn: dayOf(s.receivedOn),
      bank: names.get(s.treasuryId) ?? "—",
      inalienableYears: s.inalienableYears,
      assets: s.assets.map((x) => x.asset.label),
      years: releaseSchedule(factsOf(s), entity.fiscalYearStartMonth),
    })),
    assets,
  });
}
