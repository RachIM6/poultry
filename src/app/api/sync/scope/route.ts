import { getTenantContext, limitSignedIn } from "@/modules/identity";

// ADR-003: who this session is on the phone (the local database to open, the x-sync-scope header), asked right after
// signing in or opening a farm, before any signed-in page: a tab opened before the dashboard has rendered finds it.
// Permissions only, never the credential (poultry-auth §10). A read: no CSRF check, as sync/pull.
export async function GET(req: Request) {
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  const retry = await limitSignedIn("authenticated", req.headers, ctx.value.userId);
  if (retry) return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": String(retry) } });
  const { userId, organizationId, role } = ctx.value;
  return Response.json({ userId, organizationId, role }, { headers: { "Cache-Control": "no-store" } });
}
