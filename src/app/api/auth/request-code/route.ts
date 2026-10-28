import { isSameOriginRequest } from "@/lib/security/csrf";
import { clientNet } from "@/lib/security/rate-limit";
import { requestCode } from "@/modules/identity";

// Always 202 when not flooded: the answer never reveals whether a code was sent (poultry-auth §0.9).
// TODO(T26, before the pilot): captcha (ALTCHA) before every code request, deferred by decision on 2026-10-28.
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { phone?: unknown } | null;
  const result = await requestCode(typeof body?.phone === "string" ? body.phone : "", clientNet(req.headers));

  return result === "TOO_MANY_REQUESTS"
    ? Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "900" } })
    : Response.json({ status: "sent_if_eligible" }, { status: 202 });
}
