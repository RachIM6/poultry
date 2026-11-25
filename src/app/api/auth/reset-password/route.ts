import { readJson, tooLarge } from "@/lib/security/body";
import { isSameOriginRequest } from "@/lib/security/csrf";
import { clientOf, resetPassword } from "@/modules/identity";
import { forgetPushSubscriptions } from "@/modules/notifications";

// ADR-015: a new password with a one-time reset code from the owner or the operator. Every session of the user ends,
// and their push subscriptions go too: a lost phone stops showing notifications.
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const read = await readJson(req);
  if (!read.ok) return tooLarge();
  const body = read.value as { identifier?: unknown; code?: unknown; password?: unknown; locale?: unknown; captcha?: unknown } | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const locale = body?.locale === "fr" ? "fr" : "ar";
  const result = await resetPassword(str(body?.identifier), body?.code, str(body?.password), locale, clientOf(req.headers), forgetPushSubscriptions, body?.captcha);

  if (result.ok) return Response.json({ ok: true }, { headers: result.value }); // carries the Set-Cookie
  const status = { TOO_MANY_REQUESTS: 429, INVALID_RESET_CODE: 401 }[result.error as string] ?? 400;
  return Response.json(
    { ok: false, messageKey: `errors.${result.error}` },
    { status, headers: status === 429 ? { "Retry-After": "3600" } : undefined },
  );
}
