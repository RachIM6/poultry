import type { Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import type { AdvanceDto, PayMonthDto } from "@/modules/workforce/shared";

// For finance (SPEC-finance FN7): the pay facts recorded after `after` (this organisation's change-log version),
// oldest first. Advances are paid when recorded; a pay month is posted once validated.

const changes = async (tx: Tx, ctx: TenantContext, entity: string, after: bigint, limit: number) =>
  (await tx.change.findMany({ where: { organizationId: ctx.organizationId, entity, version: { gt: after } }, orderBy: { version: "asc" }, take: limit })).filter((c) => c.data !== null);

export async function advancesChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500) {
  return (await changes(tx, ctx, "advance", after, limit)).map((c) => ({ version: c.version, ...(c.data as unknown as AdvanceDto) }));
}

export async function payMonthsChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500) {
  return (await changes(tx, ctx, "payMonth", after, limit)).map((c) => {
    const p = c.data as unknown as PayMonthDto;
    const sum = (pick: (l: PayMonthDto["lines"][number]) => string | null) => p.lines.reduce((s, l) => s + BigInt(pick(l) ?? 0), 0n);
    const known = (pick: (l: PayMonthDto["lines"][number]) => string | null) => (p.lines.every((l) => pick(l) !== null) ? sum(pick) : null);
    return {
      version: c.version,
      id: p.id,
      month: p.month,
      grossCentimes: sum((l) => l.grossCentimes),
      advancesCentimes: sum((l) => l.advancesCentimes),
      employeeContributionCentimes: known((l) => l.employeeContributionCentimes),
      employerContributionCentimes: known((l) => l.employerContributionCentimes),
      netCentimes: sum((l) => l.netCentimes),
    };
  });
}
