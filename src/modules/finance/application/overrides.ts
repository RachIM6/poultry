import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { db, type Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { legalEntityIn, listLegalEntities, type LegalEntityDto } from "@/modules/farm-registry";
import { chartOf, leafAccounts, postingAccount, type ChartOfAccounts } from "@/modules/finance/domain/chart";
import { checkOverride, OVERRIDABLE, overridesAt, withOverrides, type OverrideError } from "@/modules/finance/domain/overrides";
import type { Posting } from "@/modules/finance/domain/posting";
import { ledgerAccounts } from "@/modules/finance/infrastructure/ledger";

const historyOf = (tx: Tx, ctx: TenantContext, legalEntityId: string) =>
  tx.postingOverride.findMany({
    where: { organizationId: ctx.organizationId, legalEntityId },
    orderBy: [{ savedAt: "asc" }, { id: "asc" }],
    select: { ruleAccount: true, account: true, savedAt: true },
  });

// ponytail: times are transaction starts, so an override saved while a posting run is in flight may count differently
// for that run's sources at their next version; lock the entity in postPending if that race ever shows.
/**
 * SPEC-finance FN8, in the caller's transaction: puts a rule's posting on the entity's overrides in force when its source
 * was first posted (`firstPosted`, null for a source never posted: those saved so far), so a later version of an old
 * source keeps its accounts (§9 "Posting overrides"). Null when the entity never saved an override.
 */
export async function overridesFor(tx: Tx, ctx: TenantContext, entity: Pick<LegalEntityDto, "id" | "accountingProfile">, chart?: ChartOfAccounts) {
  const history = await historyOf(tx, ctx, entity.id);
  if (history.length === 0) return null;
  const c = chart ?? chartOf(await ledgerAccounts(tx), entity.accountingProfile.base, entity.accountingProfile.overlays);
  return (p: Posting, firstPosted: Date | null) => withOverrides(p, overridesAt(history, firstPosted), c);
}

/** FN8: the entity's overrides in force now, rule account → replacement. */
export const currentOverrides = async (tx: Tx, ctx: TenantContext, legalEntityId: string) => overridesAt(await historyOf(tx, ctx, legalEntityId), null);

const AccountNumber = z.string().regex(/^\d{1,10}$/);
const OverrideInput = z.object({ ruleAccount: AccountNumber, account: AccountNumber.nullable() });

/** FN8: the owner replaces a default rule's account for the entity (null: back to the default), audited. New entries only. */
export async function setPostingOverride(ctx: TenantContext, input: unknown): Promise<Result<void, OverrideError | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const parsed = OverrideInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { ruleAccount, account } = parsed.data;
  const [first] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation (see postPending)
  if (!first) return fail("NOT_FOUND");
  return db.$transaction(async (tx) => {
    const entity = await legalEntityIn(tx, ctx, first.id); // row-locked: two saves at once, one after the other
    if (!entity) return fail("NOT_FOUND");
    const checked = checkOverride(ruleAccount, account, chartOf(await ledgerAccounts(tx), entity.accountingProfile.base, entity.accountingProfile.overlays));
    if (!checked.ok) return checked;
    const before = overridesAt(await historyOf(tx, ctx, entity.id), null).get(ruleAccount) ?? null;
    if (before === account) return ok(undefined);
    await tx.postingOverride.create({ data: { id: uuidv7(), organizationId: ctx.organizationId, legalEntityId: entity.id, ruleAccount, account, savedBy: ctx.userId } });
    await audit(tx, ctx, { entity: "PostingOverride", entityId: entity.id, action: "set", before: { ruleAccount, account: before }, after: { ruleAccount, account } });
    return ok(undefined);
  });
}

type Account = { number: string; label: string };
export type PostingOverrides = {
  rows: { op: string; ruleAccount: string; default: Account | null; override: (Account & { applies: boolean }) | null }[];
  choices: Account[]; // the chart's posting accounts of classes 6 and 7
};

/** FN8, the owner's screen: each overridable rule, its default account in the entity's chart and its override. */
export async function postingOverrides(ctx: TenantContext): Promise<Result<PostingOverrides | null, "FORBIDDEN">> {
  if (!can(ctx, "finance.manage")) return fail("FORBIDDEN");
  const [entity] = await listLegalEntities(ctx);
  if (!entity) return ok(null);
  const all = await ledgerAccounts(db);
  const chart = chartOf(all, entity.accountingProfile.base, entity.accountingProfile.overlays);
  const everything = chartOf(all, "cgnc", ["pca"]);
  const current = await currentOverrides(db, ctx, entity.id);
  const leaves = leafAccounts(chart).filter((a) => /^[67]/.test(a.number)).sort((a, b) => a.number.localeCompare(b.number));
  const named = (number: string): Account => ({ number, label: (chart.get(number) ?? everything.get(number))?.label ?? "" });
  return ok({
    rows: OVERRIDABLE.map(({ op, account }) => {
      const to = current.get(account);
      const general = postingAccount(account, everything, chart);
      return { op, ruleAccount: account, default: general === null ? null : named(general), override: to ? { ...named(to), applies: leaves.some((a) => a.number === to) } : null };
    }),
    choices: leaves.map((a) => ({ number: a.number, label: a.label })),
  });
}
