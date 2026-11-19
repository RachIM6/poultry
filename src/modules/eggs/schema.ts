import { z } from "zod";

// SPEC-m3 E1, the sync push's validation. The phone's screens import ./shared.ts (no Zod, ADR-009), re-exported here.
export * from "@/modules/eggs/shared";

const count = z.int32().min(0);
const Counts = z.object({ normal: count, cracked: count, dirty: count, doubleYolk: count, floor: count, broken: count });
const Sample = z.object({ count: z.int32().positive(), grams: z.int32().positive() }).nullable();

export const RecordCollection = z.object({ id: z.uuidv7(), batchId: z.uuid(), day: z.iso.date(), counts: Counts, sample: Sample });

/** E1: the counts as they should have been, while the batch is open. The batch and the day stay. */
export const CorrectCollection = z.object({ id: z.uuid(), counts: Counts, sample: Sample });
