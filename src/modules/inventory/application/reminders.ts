import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf } from "@/lib/kernel/farm-day";
import { notify } from "@/modules/notifications";
import { claimDueIssued } from "@/modules/inventory/infrastructure/repository";

// Not a member: the scheduler acts for each organisation only to notify its members (no audit, no farm data written).
const SCHEDULER = "00000000-0000-0000-0000-000000000000";

/**
 * SPEC-finance FN11, issued side, from the host's scheduler (with the push dispatch): each cheque or bill issued to a
 * supplier is announced once, from the start of its agreed day, to those who see money, unless already debited.
 * Not urgent: quiet hours hold it (N2).
 */
export async function sendIssuedReminders(clock: Clock = systemClock): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await claimDueIssued(tx, farmDayOf(clock.now()), clock.now());
    for (const r of rows) {
      await notify(
        tx,
        { organizationId: r.organizationId, userId: SCHEDULER, role: "owner" },
        { roles: ["owner", "manager"], templateKey: "issuedDue", params: { method: r.method, number: r.number ?? "—", supplier: r.supplier, amount: formatMoney(r.amountCentimes) }, urgency: "normal" },
        clock,
      );
    }
    return rows.length;
  });
}
