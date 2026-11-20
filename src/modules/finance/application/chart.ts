import { db } from "@/lib/db";
import { fail, ok } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { operationAccounts } from "@/modules/finance/domain/operations";
import { ledgerAccounts } from "@/modules/finance/infrastructure/ledger";

/** F-Chart: what each operation posts to, and whether this entity's chart is the agricultural one. Owner and manager. */
export async function chartView(ctx: TenantContext) {
  if (!can(ctx, "finance.record")) return fail("FORBIDDEN");
  const [entity] = await listLegalEntities(ctx);
  return ok({ rows: operationAccounts(await ledgerAccounts(db)), pca: entity?.accountingProfile.overlays.includes("pca") ?? true });
}
