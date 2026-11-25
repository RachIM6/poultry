import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { batchFacts } from "@/modules/flock";
import { remindedDueOn, type Reminder } from "@/modules/health/domain/vaccination";
import { claimReminders } from "@/modules/health/infrastructure/vaccinations";
import { notify } from "@/modules/notifications";
import { productNames } from "@/modules/reference-data";

// Not a member: the scheduler acts for each organisation only to notify its members (no audit, no farm data written).
const SCHEDULER = "00000000-0000-0000-0000-000000000000";

const TEMPLATES = { dayBefore: "vaccineTomorrow", dueDay: "vaccineToday" } as const satisfies Record<Reminder, string>;

/**
 * SPEC H2, from the host's scheduler (every minute, with the push dispatch): each vaccination not yet done is announced
 * to everyone who may give it, from the start of the farm day before its due day, then from the start of the due day.
 * The notifications are not urgent, so each person's quiet hours hold them (N2). Returns how many were announced.
 */
export async function sendVaccinationReminders(clock: Clock = systemClock): Promise<number> {
  const due = remindedDueOn(farmDayOf(clock.now()));
  let announced = 0;
  for (const reminder of ["dayBefore", "dueDay"] as const) {
    announced += await db.$transaction(async (tx) => {
      const rows = await claimReminders(tx, reminder, due[reminder], clock.now());
      for (const v of rows) {
        const ctx: TenantContext = { organizationId: v.organizationId, userId: SCHEDULER, role: "owner" };
        const [batch, names] = await Promise.all([batchFacts(tx, ctx, v.batchId), productNames(tx, v.productId)]);
        if (batch?.status !== "open") continue; // a closed batch's plan is over
        await notify(
          tx,
          ctx,
          {
            roles: ["owner", "manager", "worker"], // everyone who records vaccinations
            templateKey: TEMPLATES[reminder],
            params: { vaccineFr: names?.nameFr ?? v.productId, vaccineAr: names?.nameAr ?? v.productId, house: batch.houseName, age: String(v.dayOfAge), method: v.method },
            urgency: "normal",
          },
          clock,
        );
      }
      return rows.length;
    });
  }
  return announced;
}
