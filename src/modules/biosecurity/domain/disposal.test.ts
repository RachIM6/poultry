import { describe, expect, it } from "vitest";
import { checkDisposal, disposalGaps } from "./disposal";

// SPEC-m2-compliance BS6, §8 fixture.
describe("dead-bird disposal", () => {
  it("'other' needs a description of the method; the named methods don't", () => {
    expect(checkDisposal({ method: "other", methodNote: null })).toEqual({ ok: false, error: "DISPOSAL_METHOD_NOTE_REQUIRED" });
    expect(checkDisposal({ method: "other", methodNote: "fosse fermée, chaux vive" }).ok).toBe(true);
    expect(checkDisposal({ method: "incineration", methodNote: null }).ok).toBe(true);
  });

  it("puts each day's dead and culled birds next to the birds disposed, newest day first", () => {
    const mortality = [
      { day: "2026-11-04", birds: 7 },
      { day: "2026-11-05", birds: 4 },
      { day: "2026-11-05", birds: 2 }, // another batch of the farm, same day
    ];
    const disposals = [
      { day: "2026-11-05", birds: 6 },
      { day: "2026-11-03", birds: 5 },
    ];
    expect(disposalGaps(mortality, disposals)).toEqual([
      { day: "2026-11-05", dead: 6, disposed: 6, gap: 0 },
      { day: "2026-11-04", dead: 7, disposed: 0, gap: 7 },
      { day: "2026-11-03", dead: 0, disposed: 5, gap: -5 },
    ]);
  });
});
