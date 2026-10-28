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
