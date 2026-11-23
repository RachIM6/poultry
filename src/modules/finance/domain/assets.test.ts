import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { acquisitionPosting, assetCost, assetPaymentPosting, checkAsset, disposalPostings, straightLine, yearEndDepreciation, type DepreciableAsset } from "@/modules/finance/domain/assets";
import type { Posting } from "@/modules/finance/domain/posting";

const day = (d: string) => d as FarmDay;
// SPEC-finance §7.1 A: a generator, put into service on 18 Sep 2026; cost 47 350,00, no residual value, 84 months.
const generator: DepreciableAsset = { cost: 4_735_000n, residual: 0n, lifeMonths: 84, inServiceOn: day("2026-09-18"), disposedOn: null, opening: null };
const registered = { category: "equipment" as const, label: "Groupe électrogène", amount: 4_735_000n, cost: 4_735_000n };
const lines = (p: Posting) => p.lines.map((l) => [l.account, l.debit, l.credit]);
const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);
const balanced = (p: Posting) => sum(p.lines.map((l) => l.debit)) === sum(p.lines.map((l) => l.credit));

describe("straightLine (SPEC-finance FC1, FQ9, §7)", () => {
  it("§7.1 A: whole months from September, rounded once per cumulative figure, adding up to 47 350,00", () => {
    const schedule = straightLine(generator, 1);
    expect(schedule.map((y) => [y.from.slice(0, 4), y.months, y.charge])).toEqual([
      ["2026", 4, 225_476n],
      ["2027", 12, 676_429n],
      ["2028", 12, 676_428n],
      ["2029", 12, 676_429n],
      ["2030", 12, 676_428n],
      ["2031", 12, 676_429n],
      ["2032", 12, 676_429n],
      ["2033", 8, 450_952n],
    ]);
    expect(sum(schedule.map((y) => y.charge))).toBe(4_735_000n);
    expect(schedule[1]).toMatchObject({ from: "2027-01-01", to: "2027-12-31", accumulated: 901_905n, netBookValue: 3_833_095n }); // 38 330,95
    expect(schedule.at(-1)).toMatchObject({ accumulated: 4_735_000n, netBookValue: 0n, toDisposal: false });
  });

  it("§7: hens 252 000 − 90 000 over 14 months, 7 months in the year → 81 000,00", () => {
    const hens: DepreciableAsset = { cost: 25_200_000n, residual: 9_000_000n, lifeMonths: 14, inServiceOn: day("2026-06-20"), disposedOn: null, opening: null };
    expect(straightLine(hens, 1).map((y) => [y.months, y.charge])).toEqual([[7, 8_100_000n], [7, 8_100_000n]]);
  });

  it("follows the entity's fiscal year (July–June)", () => {
    expect(straightLine(generator, 7).map((y) => [y.from, y.to, y.months, y.charge]).slice(0, 2)).toEqual([
      ["2026-07-01", "2027-06-30", 10, 563_690n], // 4 735 000 × 10 ÷ 84 = 563 690,48
      ["2027-07-01", "2028-06-30", 12, 676_429n], // cumulative(22) − cumulative(10) = 1 240 119 − 563 690
    ]);
  });

  it("§7.1 A disposed of on 15 Mar 2028: 2 months used in 2028, cumulative(18) − cumulative(16) = 1 127,38", () => {
    const sold = { ...generator, disposedOn: day("2028-03-15") };
    const schedule = straightLine(sold, 1);
    expect(schedule.map((y) => [y.from.slice(0, 4), y.months, y.charge, y.toDisposal])).toEqual([
      ["2026", 4, 225_476n, false],
      ["2027", 12, 676_429n, false],
      ["2028", 2, 112_738n, true], // the disposal posts it; the close run (T103) doesn't
    ]);
    const postings = disposalPostings({ ...registered, ...sold }, 3_000_000n, "bank", null, 1);
    expect(postings.map((p) => [p.version, p.posting.journal, lines(p.posting)])).toEqual([
      [1, "OD", [["61933", 112_738n, 0n], ["2833", 0n, 112_738n]]],
      [2, "OD", [["2833", 1_014_643n, 0n], ["6513", 3_720_357n, 0n], ["2332", 0n, 4_735_000n]]], // 10 146,43 + 37 203,57 = 47 350,00
      [3, "OD", [["5141", 3_000_000n, 0n], ["7513", 0n, 3_000_000n]]],
    ]);
    expect(postings.every((p) => balanced(p.posting))).toBe(true);
  });

  it("spreads what an asset in the opening balance has left over the months left", () => {
    // In service in January 2024 for 60 months; 4 800,00 of 12 000,00 depreciated when Dawra opens on 1 Jan 2026.
    const truck: DepreciableAsset = { cost: 1_200_000n, residual: 0n, lifeMonths: 60, inServiceOn: day("2024-01-10"), disposedOn: null, opening: { on: day("2026-01-01"), accumulated: 480_000n } };
    expect(straightLine(truck, 1).map((y) => [y.from.slice(0, 4), y.months, y.charge, y.accumulated])).toEqual([
      ["2026", 12, 240_000n, 720_000n],
      ["2027", 12, 240_000n, 960_000n],
      ["2028", 12, 240_000n, 1_200_000n],
    ]);
    // Not what the life says, as typed from the accountant's balance sheet: 7 000,00 left over 36 months.
    const typed = straightLine({ ...truck, opening: { on: day("2026-01-01"), accumulated: 500_000n } }, 1);
    expect(typed.map((y) => y.charge)).toEqual([233_333n, 233_334n, 233_333n]);
  });

  it("never depreciates land", () => {
    expect(straightLine({ ...generator, lifeMonths: null }, 1)).toEqual([]);
  });

  // Property (seeded, the same run every time): the charges never go negative and add up to the base, or to the
  // cumulative figure at the disposal month; a disposal's entries balance and remove the asset at its cost.
  it("adds up to the base for any cost, residual, life, in-service and disposal days, opening balance or not", () => {
    let seed = 7;
    const next = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    const at = (index: number, d = 1 + next(28)) => day(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    for (let run = 0; run < 2000; run++) {
      const cost = BigInt(1 + next(2_000_000_000));
      const residual = next(3) === 0 ? 0n : (cost * BigInt(next(1000))) / 1000n;
      const lifeMonths = 1 + next(400);
      const inService = 2000 * 12 + next(40 * 12);
      const elapsed = next(lifeMonths); // the opening comes before the life is over
      const opening = next(2) === 0 ? null : { on: at(inService + elapsed, 1), accumulated: ((cost - residual) * BigInt(next(1000))) / 1000n };
      const start = inService + (opening ? elapsed : 0);
      const disposal = next(2) === 0 ? null : start + next(lifeMonths + 24);
      const a: DepreciableAsset = { cost, residual, lifeMonths, inServiceOn: at(inService), disposedOn: disposal === null ? null : at(disposal), opening };
      expect(checkAsset({ ...a, category: "equipment", acquiredOn: a.inServiceOn, amount: cost, vat: 0n }), `run ${run}`).toEqual({ ok: true, value: undefined });

      const schedule = straightLine(a, 1 + next(12));
      const already = opening?.accumulated ?? 0n;
      const life = lifeMonths - (start - inService);
      const months = Math.min(life, disposal === null ? life : disposal - start);
      const base = cost - residual - already;
      expect(schedule.every((y) => y.charge >= 0n && y.months > 0), `run ${run}`).toBe(true);
      expect(schedule.reduce((s, y) => s + y.months, 0), `run ${run}`).toBe(months);
      expect(sum(schedule.map((y) => y.charge)), `run ${run}`).toBe((2n * base * BigInt(months) + BigInt(life)) / (2n * BigInt(life)));
      if (disposal === null) expect(sum(schedule.map((y) => y.charge)), `run ${run}`).toBe(base);
      expect(schedule.every((y) => y.netBookValue === cost - y.accumulated)).toBe(true);

      if (disposal !== null) {
        const postings = disposalPostings({ ...registered, ...a, disposedOn: at(disposal) }, BigInt(next(2)) * cost, "cash", null, 1);
        expect(postings.every((p) => balanced(p.posting)), `run ${run}`).toBe(true);
        const exit = postings.find((p) => p.version === 2)!.posting.lines;
        expect(sum(exit.filter((l) => l.account === "2833").map((l) => l.debit)), `run ${run}`).toBe(already + sum(schedule.map((y) => y.charge)));
        expect(exit.at(-1), `run ${run}`).toMatchObject({ account: "2332", credit: cost });
      }
    }
  });
});

describe("the asset register's rules (SPEC-finance FC1)", () => {
  const asset = { ...generator, category: "equipment", acquiredOn: day("2026-09-10"), amount: 4_735_000n, vat: 0n };

  it("requires a life above zero, typed; land has none", () => {
    expect(checkAsset(asset)).toEqual({ ok: true, value: undefined });
    expect(checkAsset({ ...asset, lifeMonths: null })).toEqual({ ok: false, error: "LIFE_REQUIRED" });
    expect(checkAsset({ ...asset, lifeMonths: 0 })).toEqual({ ok: false, error: "LIFE_REQUIRED" });
    expect(checkAsset({ ...asset, category: "land", lifeMonths: null })).toEqual({ ok: true, value: undefined });
    expect(checkAsset({ ...asset, category: "land", lifeMonths: 240 })).toEqual({ ok: false, error: "LAND_NOT_DEPRECIATED" });
    expect(checkAsset({ ...asset, category: "land", lifeMonths: null, opening: { on: day("2026-01-01"), accumulated: 1n } })).toEqual({ ok: false, error: "ACCUMULATED_ABOVE_BASE" });
  });

  it("refuses what doesn't hold together", () => {
    expect(checkAsset({ ...asset, category: "boat" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(checkAsset({ ...asset, inServiceOn: day("2026-09-09") })).toEqual({ ok: false, error: "IN_SERVICE_BEFORE_ACQUISITION" });
    expect(checkAsset({ ...asset, vat: 4_735_001n })).toEqual({ ok: false, error: "VAT_MORE_THAN_AMOUNT" });
    expect(checkAsset({ ...asset, residual: 4_735_001n })).toEqual({ ok: false, error: "RESIDUAL_ABOVE_COST" });
    const opening = (accumulated: bigint, on = "2026-01-01") => ({ ...asset, inServiceOn: day("2018-09-18"), acquiredOn: day("2018-09-01"), opening: { on: day(on), accumulated } });
    expect(checkAsset(opening(4_735_001n))).toEqual({ ok: false, error: "ACCUMULATED_ABOVE_BASE" });
    expect(checkAsset(opening(4_000_000n, "2026-09-01"))).toEqual({ ok: false, error: "OPENING_LIFE_OVER" }); // 96 months gone of 84
    expect(checkAsset(opening(4_735_000n, "2026-09-01"))).toEqual({ ok: true, value: undefined }); // nothing left to spread
  });
});

describe("the asset postings (SPEC-finance FC1, FN9)", () => {
  it("posts each acquisition method's entry", () => {
    const acquisition = (paidWith: "cash" | "transfer" | "cheque" | "credit") => acquisitionPosting({ ...registered, paidWith, treasuryId: "t" });
    expect([acquisition("cash").journal, lines(acquisition("cash"))]).toEqual(["CA", [["2332", 4_735_000n, 0n], ["5161", 0n, 4_735_000n]]]);
    expect([acquisition("transfer").journal, lines(acquisition("transfer"))]).toEqual(["BQ", [["2332", 4_735_000n, 0n], ["5141", 0n, 4_735_000n]]]);
    expect([acquisition("cheque").journal, lines(acquisition("cheque"))]).toEqual(["BQ", [["2332", 4_735_000n, 0n], ["5141", 0n, 4_735_000n]]]);
    expect([acquisition("credit").journal, lines(acquisition("credit"))]).toEqual(["OD", [["2332", 4_735_000n, 0n], ["4481", 0n, 4_735_000n]]]);
    expect(acquisition("cash").lines.at(-1)?.treasuryId).toBe("t");
    expect(acquisition("credit").lines.at(-1)?.treasuryId).toBeNull();
  });

  it("keeps a registered entity's VAT out of the cost, on 3455; otherwise the VAT is part of the cost", () => {
    const [amount, vat] = [5_682_000n, 947_000n]; // 47 350,00 + 20 %
    expect(assetCost(amount, vat, false)).toBe(amount);
    expect(lines(acquisitionPosting({ ...registered, amount, cost: assetCost(amount, vat, true), paidWith: "transfer", treasuryId: null }))).toEqual([
      ["2332", 4_735_000n, 0n],
      ["3455", 947_000n, 0n],
      ["5141", 0n, 5_682_000n],
    ]);
  });

  it("posts a later payment of an asset bought on credit, D 4481 / C the cash box or the bank", () => {
    expect(lines(assetPaymentPosting("Groupe électrogène", 1_000_000n, "cheque", null))).toEqual([["4481", 1_000_000n, 0n], ["5141", 0n, 1_000_000n]]);
    expect(assetPaymentPosting("Groupe électrogène", 1n, "cash", null).journal).toBe("CA");
  });

  it("disposes of land at its cost, without depreciation; scrapping posts no price", () => {
    const land = { ...registered, category: "land" as const, lifeMonths: null, residual: 0n, inServiceOn: day("2020-01-01"), disposedOn: day("2027-05-02"), opening: null };
    expect(disposalPostings(land, 0n, "cash", null, 1).map((p) => [p.version, lines(p.posting)])).toEqual([[2, [["6513", 4_735_000n, 0n], ["23111", 0n, 4_735_000n]]]]);
  });
});

describe("the close run's depreciation (SPEC-finance FC1, FCX4, T103)", () => {
  const equipment = { ...generator, category: "equipment" as const };

  it("§7.1 A's 2026 run: D 61933 / C 2833 2 254,76", () => {
    const posting = yearEndDepreciation([equipment], day("2026-01-01"), 1);
    expect(posting && [posting.journal, lines(posting)]).toEqual(["OD", [["61933", 225_476n, 0n], ["2833", 0n, 225_476n]]]);
    expect(yearEndDepreciation([equipment], day("2034-01-01"), 1)).toBeNull(); // the life is over
  });

  it("posts one line per charge and depreciation account, paired as the CGNC pairs them; land and the disposal year stay out", () => {
    const truck = { cost: 1_200_000n, residual: 0n, lifeMonths: 60, inServiceOn: day("2026-01-10"), disposedOn: null, opening: null, category: "transport" as const };
    const land = { ...generator, lifeMonths: null, category: "land" as const };
    const sold = { ...equipment, disposedOn: day("2026-11-15") }; // its September and October: the disposal's
    const scale = { ...generator, cost: 840_000n, category: "installation" as const }; // 8 400,00 × 4 ÷ 84 = 400,00
    const posting = yearEndDepreciation([sold, truck, land, equipment, scale], day("2026-01-01"), 1);
    expect(posting && lines(posting)).toEqual([
      ["61933", 265_476n, 0n], // the generator's 2 254,76 and the scale's 400,00
      ["61934", 240_000n, 0n], // 12 months of 60: 2 400,00
      ["2833", 0n, 265_476n],
      ["2834", 0n, 240_000n],
    ]);
  });

  it("posts a building's depreciation to 61932 and a vehicle's to 61934 (CGNC 6193 sub-accounts)", () => {
    const building = { cost: 2_400_000n, residual: 0n, lifeMonths: 240, inServiceOn: day("2026-01-05"), disposedOn: null, opening: null, category: "building" as const }; // 24 000,00 × 12 ÷ 240 = 1 200,00
    const vehicle = { cost: 1_200_000n, residual: 0n, lifeMonths: 60, inServiceOn: day("2026-01-10"), disposedOn: null, opening: null, category: "transport" as const };
    const posting = yearEndDepreciation([vehicle, building], day("2026-01-01"), 1);
    expect(posting && lines(posting)).toEqual([["61932", 120_000n, 0n], ["61934", 240_000n, 0n], ["2832", 0n, 120_000n], ["2834", 0n, 240_000n]]);
    const sold = disposalPostings({ ...vehicle, label: "Camionnette", amount: 1_200_000n, disposedOn: day("2027-04-02") }, 0n, "cash", null, 1);
    expect(lines(sold[0]!.posting)).toEqual([["61934", 60_000n, 0n], ["2834", 0n, 60_000n]]); // January–March 2027
  });
});
