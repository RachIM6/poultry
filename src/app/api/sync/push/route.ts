import { isSameOriginRequest } from "@/lib/security/csrf";
import { consume } from "@/lib/security/rate-limit";
import { PushBody } from "@/lib/sync/protocol";
import { push, scopeMatches } from "@/lib/sync/server";
import { getTenantContext } from "@/modules/identity";
import { registry } from "../registry";

const MAX_BODY_BYTES = 2_000_000; // 500 mutations of a few KB

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  // 401 sends the client to login; its outbox stays on the device (poultry-auth §0.5).
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  if (!scopeMatches(req, ctx.value)) return Response.json({ ok: false, messageKey: "errors.SYNC_SCOPE" }, { status: 409 });
  if ((await consume("syncPush", { user: ctx.value.userId })).length > 0) {
    return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const text = await readCapped(req, MAX_BODY_BYTES);
  if (text === null) return Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 413 });
  const body = PushBody.safeParse(parseJson(text));
  if (!body.success) return Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 400 });

  return Response.json(await push(ctx.value, body.data.mutations, registry));
}

/** The body as text, or null past `max` bytes: stops reading there instead of buffering an oversized body first. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body) {
    size += chunk.byteLength;
    if (size > max) return null; // leaving the loop cancels the stream
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
