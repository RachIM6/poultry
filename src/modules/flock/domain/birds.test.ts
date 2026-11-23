import { describe, expect, it } from "vitest";
import { birdsOnHand } from "@/modules/flock/domain/birds";

describe("birdsOnHand (SPEC B4, B5)", () => {
  it("takes the dead, culled and sold off the birds started", () => {
    expect(birdsOnHand(990, [], [])).toBe(990);
    expect(birdsOnHand(990, [{ dead: 4, culled: 1 }, { dead: 2, culled: 0 }], [{ birds: 300 }, { birds: 83 }])).toBe(600);
    expect(birdsOnHand(990, [{ dead: 0, culled: 0 }], [{ birds: 990 }])).toBe(0);
  });
});
