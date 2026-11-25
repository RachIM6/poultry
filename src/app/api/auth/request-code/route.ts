import { isSameOriginRequest } from "@/lib/security/csrf";
import { readJson, tooLarge } from "@/lib/security/body";
import { clientOf, requestCode, smsEnabled } from "@/modules/identity";

// Always 202 when not flooded and the captcha is solved: the answer never reveals whether a code was sent (poultry-auth §0.9).
export async function POST(req: Request) {
  if (!smsEnabled()) return new Response(null, { status: 404 }); // ADR-015: SMS login is off unless AUTH_SMS_ENABLED=true
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const read = await readJson(req);
  if (!read.ok) return tooLarge();
  const body = read.value as { phone?: unknown; captcha?: unknown } | null;
  const result = await requestCode(typeof body?.phone === "string" ? body.phone : "", clientOf(req.headers), body?.captcha);

  if (result === "TOO_MANY_REQUESTS")
    return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "900" } });
  if (result === "CAPTCHA_REQUIRED") return Response.json({ ok: false, messageKey: "errors.CAPTCHA_REQUIRED" }, { status: 400 });
  return Response.json({ status: "sent_if_eligible" }, { status: 202 });
}
