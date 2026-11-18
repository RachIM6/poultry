import { timingSafeEqual } from "node:crypto";
import { sendVaccinationReminders } from "@/modules/health";
import { dispatchDuePushes } from "@/modules/notifications";
import { sendPlacementReminders } from "@/modules/planning";
import { sendInstrumentReminders } from "@/modules/sales";
import { render } from "../render";

// For the host's scheduler (every minute, T26): announces the day's vaccinations (H2), the cheques and bills due (V4)
// and tomorrow's planned placements (SPEC-m5 PL4), then sends the pushes that are due, including those quiet hours held.
// Without CRON_SECRET the route doesn't exist.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response(null, { status: 404 });
  }
  const reminded = (await sendVaccinationReminders()) + (await sendInstrumentReminders()) + (await sendPlacementReminders());
  return Response.json({ reminded, sent: await dispatchDuePushes(render) });
}
