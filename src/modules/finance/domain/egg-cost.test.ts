import { expect, it } from "vitest";
import { suggestedEggCost } from "./egg-cost";

const none = { direct: 0n, depreciation: 0n, indirect: 0n, hens: 0n };

it("§7.1 H: 453 994,52 of laying costs ÷ 700 000 eggs → 0,65 DH per egg", () => {
  // feed 360 000,00 + vet fees 3 000,00; the house's share 8 794,52; December's electricity 1 200,00; the hens 81 000,00
  expect(suggestedEggCost({ direct: 36_300_000n, depreciation: 879_452n, indirect: 120_000n, hens: 8_100_000n }, 700_000)).toEqual({
    direct: 36_300_000n,
    depreciation: 879_452n,
    indirect: 120_000n,
    hens: 8_100_000n,
    total: 45_399_452n,
    eggs: 700_000,
    perEgg: 65n, // 64,856… centimes
    reason: null,
  });
});

it("rounds half up to the centime, once", () => {
  expect(suggestedEggCost({ ...none, direct: 150n }, 100).perEgg).toBe(2n); // 1,5
  expect(suggestedEggCost({ ...none, direct: 149n }, 100).perEgg).toBe(1n);
});

it("suggests nothing without eggs or without costs, and says which", () => {
  expect(suggestedEggCost({ ...none, direct: 10_000n }, 0)).toMatchObject({ perEgg: null, reason: "NO_EGGS" });
  expect(suggestedEggCost(none, 0)).toMatchObject({ perEgg: null, reason: "NO_EGGS" });
  expect(suggestedEggCost(none, 1_000)).toMatchObject({ perEgg: null, reason: "NO_COSTS", total: 0n });
});
