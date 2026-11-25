// Public API of the `health` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema for what the offline client needs (ADR-008).
export { healthSync } from "./sync";
export { sendVaccinationReminders } from "./application/reminders";
// SPEC B1: chained after flock.correctPlacement by the sync registry (flock may not call health).
export { moveWithPlacement } from "./application/edit-plan";
export { eggWithdrawalWindowsOf, withdrawalOn } from "./application/treatments";
