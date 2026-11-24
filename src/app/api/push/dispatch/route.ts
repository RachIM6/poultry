import { timingSafeEqual } from "node:crypto";
import { sendDocumentReminders } from "@/modules/documents";
import { postAllPending, sendLoanReminders } from "@/modules/finance";
import { sendIssuedReminders } from "@/modules/inventory";
import { sendVaccinationReminders } from "@/modules/health";
import { dispatchDuePushes } from "@/modules/notifications";
import { sendPlacementReminders } from "@/modules/planning";
import { sendInstrumentReminders } from "@/modules/sales";
import { render } from "../render";

// For the host's scheduler (every minute, T26): announces the day's vaccinations (H2), the cheques and bills due (V4),
// tomorrow's planned placements (SPEC-m5 PL4), the documents coming up for renewal (SPEC-m2-compliance DC4) and the
// loan installments due (SPEC-finance FC2), posts the journal entries still pending (SPEC-finance §9 "Postings catch up"),
// then sends the pushes that are due, including those quiet hours held. Pushes go last: reminders and postings (FN17)
// create the notifications they send.
const STEPS: [name: string, run: () => Promise<unknown>][] = [
  ["vaccinationReminders", () => sendVaccinationReminders()],
  ["instrumentReminders", () => sendInstrumentReminders()],
  ["issuedReminders", () => sendIssuedReminders()],
  ["placementReminders", () => sendPlacementReminders()],
  ["documentReminders", () => sendDocumentReminders()],
  ["loanReminders", () => sendLoanReminders()],
  ["postings", () => postAllPending()],
  ["pushes", () => dispatchDuePushes(render)],
];

// Each step runs even when an earlier one throws. A failure answers 500: 207 and "200 with failed" are 2xx, which
// cron, curl --fail and hosted schedulers count as success, so a broken job would go unnoticed. Nothing is lost by
// the 500, since every other step has already run.
// Without CRON_SECRET the route doesn't exist.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response(null, { status: 404 });
  }
  const ok: string[] = [];
  const failed: string[] = [];
  for (const [step, run] of STEPS) {
    try {
      await run();
      ok.push(step);
    } catch (e) {
      failed.push(step);
      // The error's name only: messages can carry names or phone numbers.
      console.error(JSON.stringify({ level: "error", scheduler: step, error: e instanceof Error ? e.name : typeof e }));
    }
  }
  return Response.json({ ok, failed }, { status: failed.length > 0 ? 500 : 200 });
}
