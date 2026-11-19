// Public API of the `notifications` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for what the offline inbox needs (ADR-008).
export { dispatchDuePushes, notificationsSync, notify, quietHoursOf, savePushSubscription, setQuietHours } from "./service";
export type { PushSender, Render } from "./service";
export { DEFAULT_QUIET_HOURS, deliverAfter } from "./schedule";
