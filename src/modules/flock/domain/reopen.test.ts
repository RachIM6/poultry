import { describe, expect, it } from "vitest";
import { checkReopen } from "./reopen";

// SPEC B6 "Reopening" (decided default, to review).
const closed = { id: "a", houseId: "h1", species: "broiler" as const, status: "closed", closedOn: "2026-11-05", closeReason: null };
const other = (over: object) => ({ id: "b", houseId: "h1", species: "broiler" as const, status: "closed", placedOn: "2026-06-01", ...over });

describe("reopening a closed batch (SPEC B6)", () => {
  it("reopens a closed batch whose house took nothing since", () => {
    expect(checkReopen(closed, [closed as never, other({}), other({ id: "c", houseId: "h2", status: "open", placedOn: "2026-11-10" })]).ok).toBe(true);
    expect(checkReopen({ ...closed, closeReason: "Maladie" }, []).ok).toBe(true); // closed by hand too
  });

  it("refuses an open batch and a pullet batch moved to laying", () => {
    expect(checkReopen({ ...closed, status: "open", closedOn: null }, [])).toEqual({ ok: false, error: "BATCH_NOT_CLOSED" });
    expect(checkReopen({ ...closed, species: "pullet", closeReason: "transferToLaying" }, [])).toEqual({ ok: false, error: "BATCH_TRANSFERRED" });
  });

  it("refuses once the house took a batch placed on or after its closing day, open or closed again", () => {
    expect(checkReopen(closed, [other({ status: "open", placedOn: "2026-11-05" })])).toEqual({ ok: false, error: "HOUSE_HAS_NEWER_BATCH" });
    expect(checkReopen(closed, [other({ placedOn: "2026-11-20" })])).toEqual({ ok: false, error: "HOUSE_HAS_NEWER_BATCH" });
  });

  it("goes back into its house as a placement would: beside a beldi band or the other turkey sex only", () => {
    const earlier = { status: "open", placedOn: "2026-10-01" };
    expect(checkReopen(closed, [other(earlier)])).toEqual({ ok: false, error: "HOUSE_HAS_OPEN_BATCH" });
    expect(checkReopen({ ...closed, species: "beldi" }, [other({ ...earlier, species: "beldi" })]).ok).toBe(true);
    expect(checkReopen({ ...closed, species: "turkey", sex: "male" }, [other({ ...earlier, species: "turkey", sex: "female" })]).ok).toBe(true);
  });
});
