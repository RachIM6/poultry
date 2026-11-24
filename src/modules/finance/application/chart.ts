import { db } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { currentOverrides } from "@/modules/finance/application/overrides";
import { chartOf } from "@/modules/finance/domain/chart";
import { operationAccounts } from "@/modules/finance/domain/operations";
import { ledgerAccounts } from "@/modules/finance/infrastructure/ledger";

/**
 * F-Chart: what each operation posts to, the owner's override included (FN8, read-only here), and whether this entity's
 * chart is the agricultural one. Owner and manager.
 */
export async function chartView(ctx: TenantContext) {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const [entity] = await listLegalEntities(ctx);
  const all = await ledgerAccounts(db);
  const overrides = entity && { chart: chartOf(all, entity.accountingProfile.base, entity.accountingProfile.overlays), overrides: await currentOverrides(db, ctx, entity.id) };
  return ok({ rows: operationAccounts(all, overrides ?? undefined), pca: entity?.accountingProfile.overlays.includes("pca") ?? true });
}
