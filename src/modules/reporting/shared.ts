// What the phone's screens need from reporting, without Zod (ADR-009): the register builder runs on the phone.
export { buildRegister } from "@/modules/reporting/domain/register";
export type { Register, RegisterInput } from "@/modules/reporting/domain/register";
export { buildBatchReport } from "@/modules/reporting/domain/report";
export type { BatchReport, ResultRow } from "@/modules/reporting/domain/report";
export { INSPECTION_LOOKBACK_MONTHS, inPack, inspectionChecklist, inspectionSince } from "@/modules/reporting/domain/inspection";
export type { Missing } from "@/modules/reporting/domain/inspection";
