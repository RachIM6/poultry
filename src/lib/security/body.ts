import { fail, ok, type Result } from "@/lib/kernel/result";

// Route handlers read bodies through here, never with req.json() / req.arrayBuffer(): those buffer whatever the client
// sends, before any rate limit. proxy.ts doesn't cap /api (its matcher leaves it out).

/** A small JSON body (login, locale, quiet hours, a push subscription, onboarding): a few hundred bytes at most. */
export const MAX_JSON_BYTES = 4_096;

/** The body, or null past `max` bytes: stops reading there instead of buffering an oversized body first. */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body) {
    size += chunk.byteLength;
    if (size > max) return null; // leaving the loop cancels the stream
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** The parsed JSON body (null when it isn't JSON), or TOO_LARGE past `max` bytes. */
export async function readJson(req: Request, max = MAX_JSON_BYTES): Promise<Result<unknown, "TOO_LARGE">> {
  const bytes = await readCapped(req, max);
  if (bytes === null) return fail("TOO_LARGE");
  try {
    return ok(JSON.parse(Buffer.from(bytes).toString("utf8")));
  } catch {
    return ok(null);
  }
}

/** The answer to a body past its cap. */
export const tooLarge = () => Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 413 });
