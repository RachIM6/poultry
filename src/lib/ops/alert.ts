type Alerts = {
  sms_cap_50: Record<string, number>;
  sms_cap_100: Record<string, number>;
  scheduler_failed: { step: string }; // a STEPS name in /api/push/dispatch, a fixed string
};

/**
 * Alerts for whoever runs the platform: one error-level JSON line per event, which a log alert can match on
 * `"alert":"<event>"`, and, when OPS_ALERT_WEBHOOK_URL is set, the same event POSTed there as JSON (any incoming
 * webhook: chat, or an email relay). Data holds numbers and fixed names only, so no phone number or IP can slip in
 * (law 09-08). Never throws, and never holds the request: inside one, the POST runs after the response (`after`).
 * `next/server` is imported only when there is something to post: scripts bundled for plain Node (db:seed:demo,
 * org:*) reach this file through the rate limiter, and Node's ESM loader can't resolve that bare specifier.
 */
export function alertOps<E extends keyof Alerts>(event: E, data: Alerts[E]) {
  const line = { level: "error", alert: event, ...data };
  console.error(JSON.stringify(line));
  const url = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!url) return;
  // `text` and `content` are the message fields Slack-style and Discord webhooks display.
  const text = `${event} ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" ")}`;
  const post = () =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...line, text, content: text }),
      signal: AbortSignal.timeout(3_000),
    }).then(
      (res) => void (!res.ok && console.error(JSON.stringify({ level: "error", alertWebhook: res.status }))),
      (e: unknown) => console.error(JSON.stringify({ level: "error", alertWebhook: e instanceof Error ? e.name : typeof e })), // never the URL: it is a secret
    );
  // Outside a request (a script, a test), or where next/server doesn't load, `after` throws: fire and forget instead.
  void import("next/server").then(({ after }) => after(post)).catch(() => void post());
}
