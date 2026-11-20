import { db, type Tx } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { monthEnd } from "@/modules/workforce/domain/pay";
import type { AdvanceDto, PayMonthDto, PayPaymentDto } from "@/modules/workforce/shared";

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
      // per worker: advances beyond their pay stay owed (finance takes back only what the pay covers)
      advancesCentimes: p.lines.reduce((s, l) => s + BigInt(l.advancesCentimes) + (BigInt(l.netCentimes) < 0n ? BigInt(l.netCentimes) : 0n), 0n),
      employeeContributionCentimes: known((l) => l.employeeContributionCentimes),
      employerContributionCentimes: known((l) => l.employerContributionCentimes),
      netCentimes: p.lines.reduce((s, l) => s + (BigInt(l.netCentimes) > 0n ? BigInt(l.netCentimes) : 0n), 0n), // what is owed to them
    };
  });
}

export async function payPaymentsChangedSince(tx: Tx, ctx: TenantContext, after: bigint, limit = 500) {
  return (await changes(tx, ctx, "payPayment", after, limit)).map((c) => ({ version: c.version, ...(c.data as unknown as PayPaymentDto) }));
}

/**
 * For finance's batch results (FN14, plan-m4 "Later"): each validated month's labour cost on its farm, gross pay plus
 * the employer's CNSS share when its rate is entered, to share over that farm's batches of the month.
 */
export async function payCosts(tx: Tx, ctx: TenantContext): Promise<{ id: string; farmId: string; month: string; costCentimes: bigint }[]> {
  const months = await tx.payMonth.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { id: "asc" } });
  return months.map((m) => ({
    id: m.id,
    farmId: m.farmId,
    month: m.month,
    costCentimes: (m.lines as unknown as PayMonthDto["lines"]).reduce((s, l) => s + BigInt(l.grossCentimes) + BigInt(l.employerContributionCentimes ?? 0), 0n),
  }));
}

/** For finance's cash schedule: validated months whose wages aren't paid yet, due at the month's end. */
export async function wagesDue(ctx: TenantContext): Promise<{ dueOn: string; amountCentimes: bigint }[]> {
  const where = { organizationId: ctx.organizationId };
  const [months, paid] = await Promise.all([db.payMonth.findMany({ where }), db.payPayment.findMany({ where, select: { farmId: true, month: true } })]);
  const done = new Set(paid.map((p) => `${p.farmId}:${p.month}`));
  return months
    .filter((m) => !done.has(`${m.farmId}:${m.month}`))
    .map((m) => ({ dueOn: monthEnd(m.month), amountCentimes: (m.lines as unknown as PayMonthDto["lines"]).reduce((s, l) => s + (BigInt(l.netCentimes) > 0n ? BigInt(l.netCentimes) : 0n), 0n) }))
    .filter((d) => d.amountCentimes > 0n);
}
