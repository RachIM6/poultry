import { z } from "zod";

// SPEC-m3 E1, the sync push's validation. The phone's screens import ./shared.ts (no Zod, ADR-009), re-exported here.
export * from "@/modules/eggs/shared";

const count = z.int32().min(0);
const Counts = z.object({ normal: count, cracked: count, dirty: count, doubleYolk: count, floor: count, broken: count });
const Sample = z.object({ count: z.int32().positive(), grams: z.int32().positive() }).nullable();

export const RecordCollection = z.object({ id: z.uuidv7(), batchId: z.uuid(), day: z.iso.date(), counts: Counts, sample: Sample });

/** E1: the counts as they should have been, while the batch is open. The batch and the day stay. */
export const CorrectCollection = z.object({ id: z.uuid(), counts: Counts, sample: Sample });

const gradeId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(20); // reference-data's EggGrade id (the phone lists them)
const item = z.union([z.literal("ungraded"), z.literal("downgraded"), z.templateLiteral(["grade:", gradeId])]);

/** E3: a laying day of a batch sorted into grade classes. */
export const GradeEggs = z.object({
  id: z.uuidv7(),
  batchId: z.uuid(),
  laidOn: z.iso.date(),
  grades: z.record(gradeId, z.int32().min(0)).refine((g) => Object.keys(g).length > 0 && Object.keys(g).length <= 10, "1 to 10 grades"),
});

/** E3: eggs thrown away from a lot, on the phone's farm day `day` (optional: phones from before it was sent, see discardEggs). */
export const DiscardEggs = z.object({ id: z.uuidv7(), batchId: z.uuid(), laidOn: z.iso.date(), item, eggs: z.int32().positive(), reason: z.string().trim().min(1).max(200), day: z.iso.date().optional() });
