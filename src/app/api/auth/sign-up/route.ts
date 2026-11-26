import { readJson, tooLarge } from "@/lib/security/body";
import { isSameOriginRequest } from "@/lib/security/csrf";
import { clientOf, signUp } from "@/modules/identity";

// ADR-015: a new account (first and last name, phone and/or email, password), with an invite code to join an organisation. Captcha always.
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const read = await readJson(req);
  if (!read.ok) return tooLarge();
  const body = read.value as { firstName?: unknown; lastName?: unknown; phone?: unknown; email?: unknown; password?: unknown; inviteCode?: unknown; locale?: unknown; captcha?: unknown } | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const locale = body?.locale === "fr" ? "fr" : "ar";
  const input = { firstName: body?.firstName, lastName: body?.lastName, phone: str(body?.phone), email: str(body?.email), password: str(body?.password), inviteCode: str(body?.inviteCode) };
  const result = await signUp(input, locale, clientOf(req.headers), body?.captcha);

  if (result.ok) return Response.json({ ok: true, joined: result.value.joined }, { status: 201, headers: result.value.headers });
  const status = { TOO_MANY_REQUESTS: 429, ACCOUNT_EXISTS: 409 }[result.error as string] ?? 400;
  return Response.json(
    { ok: false, messageKey: `errors.${result.error}` },
    { status, headers: status === 429 ? { "Retry-After": "3600" } : undefined },
  );
}
