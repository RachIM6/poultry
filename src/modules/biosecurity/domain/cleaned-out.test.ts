import { describe, expect, it } from "vitest";
import { cleanedOutSince } from "./cleanout";

// SPEC B6 "Reopening": a closed batch's house cleaned out since (BS4) can't take it back.
const batch = { id: "a", houseId: "h1", closedOn: "2026-11-05" };
describe("a house cleaned out since a batch closed", () => {
  it("counts a clean-out after the batch, or of its house on or after the closing day", () => {
    expect(cleanedOutSince([{ houseId: "h1", afterBatchId: "a", startedOn: "2026-11-04" }], batch)).toBe(true);
    expect(cleanedOutSince([{ houseId: "h1", afterBatchId: "z", startedOn: "2026-11-05" }], batch)).toBe(true);
  });

  it("not an earlier clean-out of the house, nor one of another house", () => {
    expect(cleanedOutSince([{ houseId: "h1", afterBatchId: "z", startedOn: "2026-06-01" }, { houseId: "h2", afterBatchId: "y", startedOn: "2026-11-20" }], batch)).toBe(false);
    expect(cleanedOutSince([], batch)).toBe(false);
  });
});
