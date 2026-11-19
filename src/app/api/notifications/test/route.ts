import { after } from "next/server";
import { db } from "@/lib/db";
import { isSameOriginRequest } from "@/lib/security/csrf";
import { getTenantContext } from "@/modules/identity";
import { dispatchDuePushes, notify } from "@/modules/notifications";
import { render } from "../../push/render";

// T12 acceptance: "send me a test notification". Normal urgency, so quiet hours apply like for any other.
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  await db.$transaction((tx) => notify(tx, ctx.value, { userIds: [ctx.value.userId], templateKey: "test", urgency: "normal" }));
  after(() => dispatchDuePushes(render)); // push after commit and after the response
  return Response.json({ ok: true }, { status: 201 });
}
