import { batchResultDtos } from "@/modules/finance";
import { getTenantContext, limitSignedIn } from "@/modules/identity";

// SPEC-finance §9 "One cost per kg": FN13's batch results for the offline screens that show a batch's money (the
// closing card, /compare), read when online, so they show /results' figures. Owner, manager, accountant (money.read);
// a worker gets 403. A read: no CSRF check (SameSite=Lax session cookie, and a cross-site page can't read the response).
export async function GET(req: Request) {
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  const retry = await limitSignedIn("authenticated", req.headers, ctx.value.userId);
  if (retry) return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": String(retry) } });
  const results = await batchResultDtos(ctx.value);
  if (!results.ok) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  return Response.json(results.value, { headers: { "Cache-Control": "no-store" } });
}
