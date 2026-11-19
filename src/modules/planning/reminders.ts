import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, nextFarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { houseOf } from "@/modules/flock";
import { notify } from "@/modules/notifications";

// Not a member: the scheduler acts for each organisation only to notify its members (no audit, no farm data written).
const SCHEDULER = "00000000-0000-0000-0000-000000000000";

/**
 * SPEC-m5 PL4, from the host's scheduler (every minute, with the push dispatch): each plan still planned for tomorrow
 * is announced once to the owners and managers, from the start of the farm day before. Not urgent, so quiet hours hold
 * it (N2). The claim (remindedAt) and the notifications are one transaction. Returns how many plans were announced.
 */
export async function sendPlacementReminders(clock: Clock = systemClock): Promise<number> {
  const tomorrow = nextFarmDay(farmDayOf(clock.now()));
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ organizationId: string; houseId: string; chicks: number; hatchery: string }[]>`
      UPDATE "PlannedBatch" SET "remindedAt" = ${clock.now()}
      WHERE status = 'planned' AND "placeOn" = ${tomorrow}::date AND "remindedAt" IS NULL
      RETURNING "organizationId", "houseId", chicks, hatchery`;
    for (const p of rows) {
      const ctx: TenantContext = { organizationId: p.organizationId, userId: SCHEDULER, role: "owner" };
      const house = await houseOf(tx, ctx, p.houseId);
      await notify(tx, ctx, { roles: ["owner", "manager"], templateKey: "placementTomorrow", params: { house: house?.name ?? "", chicks: String(p.chicks), hatchery: p.hatchery }, urgency: "normal" }, clock);
    }
    return rows.length;
  });
}
