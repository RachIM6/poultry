import { isSameOriginRequest } from "@/lib/security/csrf";
import { getTenantContext } from "@/modules/identity";
import { savePushSubscription } from "@/modules/notifications";

// SPEC N1: this browser accepted push; its endpoint now reaches the signed-in user.
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  const saved = await savePushSubscription(ctx.value.userId, await req.json().catch(() => null));
  return saved.ok ? Response.json({ ok: true }, { status: 201 }) : Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 400 });
}
