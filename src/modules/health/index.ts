// Public API of the `health` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for what the offline client needs (ADR-008).
export { healthSync } from "./sync";
export { sendVaccinationReminders } from "./application/reminders";
export { withdrawalOn } from "./application/treatments";
