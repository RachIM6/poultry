import { isSameOriginRequest } from "@/lib/security/csrf";
import { clientOf, verifyCode } from "@/modules/identity";

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { phone?: unknown; code?: unknown; locale?: unknown; captcha?: unknown } | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const locale = body?.locale === "fr" ? "fr" : "ar";
  const result = await verifyCode(str(body?.phone), str(body?.code), locale, clientOf(req.headers), body?.captcha, req.headers);

  if (result.ok) return Response.json({ ok: true }, { headers: result.value }); // carries the Set-Cookie
  if (result.error === "CAPTCHA_REQUIRED") return Response.json({ ok: false, messageKey: "errors.CAPTCHA_REQUIRED" }, { status: 400 });
  return result.error === "TOO_MANY_REQUESTS"
    ? Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "3600" } })
    : Response.json({ ok: false, messageKey: "errors.INVALID_OR_EXPIRED_CODE" }, { status: 401 });
}
