import { createHash } from "node:crypto";
import { consume } from "@/lib/security/rate-limit";
import { getTenantContext } from "@/modules/identity";
import { getReferenceData } from "@/modules/reference-data";

// R4: the phone keeps this in IndexedDB and asks again with If-None-Match; a 304 costs no transfer.
// no-store: the browser's HTTP cache isn't the offline copy, and the response sits behind a session.
export async function GET(req: Request) {
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  if ((await consume("syncPull", { user: ctx.value.userId })).length > 0) {
    return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const body = JSON.stringify(await getReferenceData());
  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  const headers = { etag, "cache-control": "no-store" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "content-type": "application/json" } });
}
