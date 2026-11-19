import { timingSafeEqual } from "node:crypto";
import { dispatchDuePushes } from "@/modules/notifications";
import { render } from "../render";

// For the host's scheduler (every minute, T26): sends pushes held by quiet hours once they are due.
// Without CRON_SECRET the route doesn't exist.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response(null, { status: 404 });
  }
  return Response.json({ sent: await dispatchDuePushes(render) });
}
