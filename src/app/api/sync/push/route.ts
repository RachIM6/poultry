import { isSameOriginRequest } from "@/lib/security/csrf";
import { consume } from "@/lib/security/rate-limit";
import { PushBody } from "@/lib/sync/protocol";
import { push } from "@/lib/sync/server";
import { getTenantContext } from "@/modules/identity";
import { registry } from "../registry";

const MAX_BODY_CHARS = 2_000_000; // 500 mutations of a few KB; checked before parsing

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  // 401 sends the client to login; its outbox stays on the device (poultry-auth §0.5).
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  if ((await consume("syncPush", { user: ctx.value.userId })).length > 0) {
    return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) return Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 413 });
  const body = PushBody.safeParse(parseJson(text));
  if (!body.success) return Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 400 });

  return Response.json(await push(ctx.value, body.data.mutations, registry));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
