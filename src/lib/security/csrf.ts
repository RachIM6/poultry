// CSRF check for state-changing route handlers (poultry-auth §4). Server actions have Next's own Origin check.
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin") ?? originOf(req.headers.get("referer"));
  return origin === process.env.APP_ORIGIN && req.headers.get("x-requested-with") === "poultry";
}

function originOf(url: string | null) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}
