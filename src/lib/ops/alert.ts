/**
 * Alerts for whoever runs the platform. Today one error-level JSON line per event, which a log alert can match on
 * `"alert":"<event>"`. Needs owner: the real channel (webhook or email) plugs in here, and only here, once the host
 * is chosen (OQ1; tasks/todo.md T26).
 * Data holds numbers only, so no phone number or IP can slip in (law 09-08).
 */
export function alertOps(event: "sms_cap_50" | "sms_cap_100", data: Record<string, number>) {
  console.error(JSON.stringify({ level: "error", alert: event, ...data }));
}
