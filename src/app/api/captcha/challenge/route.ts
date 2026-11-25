import { createCaptchaChallenge } from "@/lib/security/captcha";
import { consume } from "@/lib/security/rate-limit";
import { clientOf, recordAuthEvent } from "@/modules/identity";

// A fresh signed proof-of-work challenge for the login form (poultry-auth references/captcha.md, server rule 1).
// Never prerendered: it reads the request headers, queries the rate-limit table and draws a random challenge, each of
// which stops prerendering (Next 16 route handlers with Cache Components). A shared static one would break every login.
export async function GET(req: Request) {
  const client = clientOf(req.headers);
  const blocked = await consume("captchaChallenge", { ip: client.ip, subnet: client.subnet });
  if (blocked.length > 0) {
    await recordAuthEvent("rate_limited", client, { reason: `captchaChallenge:${blocked.join(",")}` });
    return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "900" } });
  }
  return Response.json(await createCaptchaChallenge(), { headers: { "cache-control": "no-store" } });
}
