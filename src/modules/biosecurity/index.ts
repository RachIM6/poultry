// Public API of the `biosecurity` module (see CAPABILITY-MAP.md). Other modules import only from here,
// or from ./schema and ./shared for what the offline client needs (ADR-008, ADR-009).
export { biosecuritySync } from "./service";
