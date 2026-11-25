import { readJson, tooLarge } from "@/lib/security/body";
import { isSameOriginRequest } from "@/lib/security/csrf";
import { clientOf, signIn } from "@/modules/identity";

// ADR-015: the phone or the email, and the password. One answer for every refusal (poultry-auth §0.9).
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const read = await readJson(req);
  if (!read.ok) return tooLarge();
  const body = read.value as { identifier?: unknown; password?: unknown; locale?: unknown; captcha?: unknown } | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const locale = body?.locale === "fr" ? "fr" : "ar";
  const result = await signIn(str(body?.identifier), str(body?.password), locale, clientOf(req.headers), body?.captcha, req.headers);

  if (result.ok) return Response.json({ ok: true }, { headers: result.value }); // carries the Set-Cookie
  if (result.error === "CAPTCHA_REQUIRED") return Response.json({ ok: false, messageKey: "errors.CAPTCHA_REQUIRED" }, { status: 400 });
  return result.error === "TOO_MANY_REQUESTS"
    ? Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "3600" } })
    : Response.json({ ok: false, messageKey: "errors.INVALID_CREDENTIALS" }, { status: 401 });
}
