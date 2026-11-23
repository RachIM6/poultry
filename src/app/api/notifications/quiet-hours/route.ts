import { isSameOriginRequest } from "@/lib/security/csrf";
import { getTenantContext, limitSignedIn } from "@/modules/identity";
import { quietHoursOf, setQuietHours } from "@/modules/notifications";

// SPEC N2: each user's own quiet hours.
export async function GET(req: Request) {
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  return Response.json(await quietHoursOf(ctx.value.userId), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  const retry = await limitSignedIn("authenticated", req.headers, ctx.value.userId);
  if (retry) return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": String(retry) } });
  const saved = await setQuietHours(ctx.value.userId, await req.json().catch(() => null));
  return saved.ok ? Response.json({ ok: true }) : Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 400 });
}
