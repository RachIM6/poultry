// Client-side POST to our route handlers. The custom header is half of the CSRF check (src/lib/security/csrf.ts).
export async function postJson(url: string, body?: unknown): Promise<{ status: number; messageKey?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "poultry" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => ({}))) as { messageKey?: string };
    return { status: res.status, messageKey: json.messageKey };
  } catch {
    return { status: 0, messageKey: "errors.NETWORK" };
  }
}

/**
 * Right after signing in or opening a farm, before navigating: stores who is signed in on this phone (ADR-003), so an
 * offline screen opened before the dashboard has rendered finds it. A new scope opens its own database, and a role
 * change clears the local records first (rememberScope). Dexie loads only now, off the login page's first load. Never
 * blocks: on any failure the dashboard's SyncBadge remembers it, as before.
 */
export async function rememberSignedIn() {
  try {
    const res = await fetch("/api/sync/scope", { headers: { "x-requested-with": "poultry" } });
    if (res.ok) await (await import("@/offline/db")).rememberScope(await res.json());
  } catch {}
}
