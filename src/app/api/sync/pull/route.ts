import { consume } from "@/lib/security/rate-limit";
import { PullQuery } from "@/lib/sync/protocol";
import { pull } from "@/lib/sync/server";
import { getTenantContext } from "@/modules/identity";
import { registry } from "../registry";

// A read: no CSRF check. The session cookie is SameSite=Lax and the JSON is not readable cross-origin.
export async function GET(req: Request) {
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  if ((await consume("syncPull", { user: ctx.value.userId })).length > 0) {
    return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const query = PullQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 400 });
  return Response.json(await pull(ctx.value, query.data.since, registry), { headers: { "Cache-Control": "no-store" } });
}
