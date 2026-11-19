import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { notify } from "@/modules/notifications";
import { claimDueInstruments } from "@/modules/sales/infrastructure/sales";

// Not a member: the scheduler acts for each organisation only to notify its members (no audit, no farm data written).
const SCHEDULER = "00000000-0000-0000-0000-000000000000";

/**
 * SPEC V4, from the host's scheduler (every minute, with the push dispatch): each cheque or bill of exchange is
 * announced once, from the start of its due day, to those who see money. Not urgent: quiet hours hold it (N2).
 */
export async function sendInstrumentReminders(clock: Clock = systemClock): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await claimDueInstruments(tx, farmDayOf(clock.now()), clock.now());
    for (const r of rows) {
      await notify(
        tx,
        { organizationId: r.organizationId, userId: SCHEDULER, role: "owner" },
        { roles: ["owner", "manager"], templateKey: "instrumentDue", params: { method: r.method, number: r.number, buyer: r.buyer, amount: formatMoney(r.amountCentimes) }, urgency: "normal" },
        clock,
      );
    }
    return rows.length;
  });
}
