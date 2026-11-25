import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { ASSET_CATEGORIES, type AssetCategory, type DepreciableAsset } from "@/modules/finance/domain/assets";
import { fiscalYearOf } from "@/modules/finance/domain/entry";
import { checkSubsidy, receiptPosting, releaseSchedule, subsidyRelease, yearEndRelease, type Subsidy } from "@/modules/finance/domain/subsidies";

const day = (d: string) => d as FarmDay;
const year = (y: number) => ({ from: day(`${y}-01-01`), to: day(`${y}-12-31`) });
// SPEC-finance §7.1 A: the generator, 47 350,00, in service on 18 Sep 2026, 84 months; a subsidy of 14 205,00 on it.
const generator: DepreciableAsset & { category: AssetCategory } = { category: "equipment", cost: 4_735_000n, residual: 0n, lifeMonths: 84, inServiceOn: day("2026-09-18"), disposedOn: null, opening: null };
const subsidy: Subsidy = { amount: 1_420_500n, receivedOn: day("2026-10-05"), inalienableYears: null, assets: [generator] };
// SPEC-finance §7.1 E (FQ17): land bought 30 000,00, never depreciated.
const land: DepreciableAsset & { category: AssetCategory } = { category: "land", cost: 3_000_000n, residual: 0n, lifeMonths: null, inServiceOn: day("2026-09-01"), disposedOn: null, opening: null };
const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);

describe("subsidyRelease (SPEC-finance FC2, FQ17, §7)", () => {
  it("§7.1 A: 676,43 in 2026, 2 029,29 in 2027, rounded once per cumulative figure", () => {
    expect(subsidyRelease(subsidy, year(2026), 1)).toBe(67_643n); // 1 420 500 × 225 476 ÷ 4 735 000 = 67 642,8
    expect(subsidyRelease(subsidy, year(2027), 1)).toBe(202_929n); // 270 571,5 → 270 572 released to date, − 67 643
    const schedule = releaseSchedule(subsidy, 1);
    expect(schedule.map((y) => [y.from.slice(0, 4), y.release])).toEqual([
      ["2026", 67_643n], ["2027", 202_929n], ["2028", 202_928n], ["2029", 202_929n], ["2030", 202_928n], ["2031", 202_929n], ["2032", 202_928n], ["2033", 135_286n],
    ]);
    expect(schedule.at(-1)?.released).toBe(1_420_500n);
  });

  it("releases nothing before the year received; that year catches up with the depreciation so far", () => {
    const late = { ...subsidy, receivedOn: day("2027-03-01") };
    expect(subsidyRelease(late, year(2026), 1)).toBe(0n);
    expect(subsidyRelease(late, year(2027), 1)).toBe(270_572n); // 2026's share too
    expect(subsidyRelease(late, year(2028), 1)).toBe(202_928n);
  });

  it("stops with the depreciation when an asset is disposed of; the rest stays on 1311 (FQ28)", () => {
    const sold = { ...subsidy, assets: [{ ...generator, disposedOn: day("2028-03-15") }] };
    expect(releaseSchedule(sold, 1).map((y) => y.release)).toEqual([67_643n, 202_929n, 33_821n]); // 0,3 × cumulative(18) 1 014 643 = 304 392,9 → 304 393 − 270 572
    expect(subsidyRelease(sold, year(2029), 1)).toBe(0n);
  });

  it("posts the receipt D 5141 / C 1311 (BQ) and the year's release D 1319 / C 7577 (OD)", () => {
    expect(receiptPosting("Fonds de développement agricole", 1_420_500n, "bank-1")).toEqual({
      journal: "BQ",
      label: "Subvention d’investissement : Fonds de développement agricole",
      lines: [{ account: "5141", debit: 1_420_500n, credit: 0n, treasuryId: "bank-1" }, { account: "1311", debit: 0n, credit: 1_420_500n }],
    });
    const twice = yearEndRelease([subsidy, { ...subsidy, amount: 100n }], year(2026), 1);
    expect(twice?.journal).toBe("OD");
    expect(twice?.lines).toEqual([{ account: "1319", debit: 67_648n, credit: 0n }, { account: "7577", debit: 0n, credit: 67_648n }]); // 67 643 + 4,76 → 5
    expect(yearEndRelease([subsidy], year(2025), 1)).toBeNull();
  });

  it("accepts land (FQ17, PCA p. 75); refuses no asset, or depreciable assets with nothing to depreciate", () => {
    expect(checkSubsidy([])).toEqual({ ok: false, error: "SUBSIDY_NO_ASSET" });
    expect(checkSubsidy([land]).ok).toBe(true);
    expect(checkSubsidy([land, generator]).ok).toBe(true);
    expect(checkSubsidy([{ ...land, cost: 0n }])).toEqual({ ok: false, error: "SUBSIDY_NO_ASSET" });
    expect(checkSubsidy([{ ...generator, residual: generator.cost }])).toEqual({ ok: false, error: "SUBSIDY_NO_ASSET" });
    expect(checkSubsidy([land, { ...generator, residual: generator.cost }])).toEqual({ ok: false, error: "SUBSIDY_NO_ASSET" });
    expect(checkSubsidy([generator]).ok).toBe(true);
  });

  it("§7.1 E: land without an inalienability clause releases a tenth a year from the year received", () => {
    const onLand: Subsidy = { amount: 5_000_000n, receivedOn: day("2026-10-05"), inalienableYears: null, assets: [land] };
    const schedule = releaseSchedule(onLand, 1);
    expect(schedule.map((y) => [y.from.slice(0, 4), y.release])).toEqual(Array.from({ length: 10 }, (_, k) => [String(2026 + k), 500_000n]));
    expect(subsidyRelease(onLand, year(2036), 1)).toBe(0n);
    expect(yearEndRelease([onLand], year(2026), 1)?.lines).toEqual([{ account: "1319", debit: 500_000n, credit: 0n }, { account: "7577", debit: 0n, credit: 500_000n }]);
  });

  it("§7.1 E: over the inalienable years when the contract has the clause, the last year taking what is left", () => {
    const three: Subsidy = { amount: 5_000_000n, receivedOn: day("2026-10-05"), inalienableYears: 3, assets: [land] };
    expect(releaseSchedule(three, 1).map((y) => y.release)).toEqual([1_666_667n, 1_666_667n, 1_666_666n]);
    const tiny: Subsidy = { ...three, amount: 5n, inalienableYears: 10 }; // 0,5 centime a year rounds up: capped, never negative
    expect(releaseSchedule(tiny, 1).map((y) => y.release)).toEqual([1n, 1n, 1n, 1n, 1n, 0n, 0n, 0n, 0n, 0n]);
    const late: Subsidy = { ...three, receivedOn: day("2028-02-01") }; // received later: its first year is 2028
    expect([2027, 2028, 2031].map((y) => subsidyRelease(late, year(y), 1))).toEqual([0n, 1_666_667n, 0n]);
  });

  it("§7.1 E: land and the generator share the subsidy by cost, each part by its own rule", () => {
    const mixed: Subsidy = { amount: 2_000_000n, receivedOn: day("2026-10-05"), inalienableYears: null, assets: [land, generator] };
    // land 2 000 000 × 3 000 000 ÷ 7 735 000 = 775 694,9 → 775 695, a tenth 77 570; the generator's 1 224 305 × 225 476 ÷ 4 735 000 → 58 300
    expect(subsidyRelease(mixed, year(2026), 1)).toBe(135_870n);
    expect(subsidyRelease(mixed, year(2027), 1)).toBe(252_471n); // 77 570 + 233 201 − 58 300
    const schedule = releaseSchedule(mixed, 1);
    expect(schedule.map((y) => y.from.slice(0, 4))).toEqual(["2026", "2027", "2028", "2029", "2030", "2031", "2032", "2033", "2034", "2035"]);
    expect(schedule.at(-1)?.released).toBe(2_000_000n);
  });

  it("stops land's release from the year it is disposed of (FQ28)", () => {
    const sold: Subsidy = { amount: 5_000_000n, receivedOn: day("2026-10-05"), inalienableYears: null, assets: [{ ...land, disposedOn: day("2029-06-30") }] };
    expect(releaseSchedule(sold, 1).map((y) => y.release)).toEqual([500_000n, 500_000n, 500_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
  });

  // Property (seeded, the same run every time, no fast-check): for any subsidy on 1–3 assets (cost, residual, life,
  // in-service day, opening balance or not, land or not with any inalienable years, any fiscal-year start, received any
  // day), the releases by year never go negative and add up to the subsidy over the assets' life and the land's years;
  // the close run's entry is the year's release.
  it("adds the releases up to the subsidy for any assets, receipt day and fiscal year", () => {
    let seed = 17;
    const next = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    const anyDay = (from: number, years: number) => day(`${from + next(years)}-${String(1 + next(12)).padStart(2, "0")}-${String(1 + next(28)).padStart(2, "0")}`);
    const depreciable = ASSET_CATEGORIES.filter((c) => !c.includes("land"));
    const lands = ASSET_CATEGORIES.filter((c) => c.includes("land") && !c.includes("other")); // land, prepared land
    for (let run = 0; run < 1000; run++) {
      const startMonth = 1 + next(12);
      const assets = Array.from({ length: 1 + next(3) }, () => {
        const cost = BigInt(1 + next(500_000_000));
        const residual = next(3) === 0 ? BigInt(next(Number(cost))) : 0n;
        const lifeMonths = 1 + next(240);
        const inServiceOn = anyDay(2015, 15);
        const months = next(lifeMonths); // an asset bought before Dawra: some of its life already used
        const at = Number(inServiceOn.slice(0, 4)) * 12 + Number(inServiceOn.slice(5, 7)) - 1 + months; // that many months later
        const on = day(`${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}-01`);
        const opening = next(4) === 0 ? { on, accumulated: ((cost - residual) * BigInt(months)) / BigInt(lifeMonths) } : null;
        if (next(4) === 0) return { category: lands[next(lands.length)], cost, residual: 0n, lifeMonths: null, inServiceOn, disposedOn: null, opening: null }; // FQ17
        return { category: depreciable[next(depreciable.length)], cost, residual, lifeMonths, inServiceOn, disposedOn: null, opening };
      });
      const s: Subsidy = { amount: BigInt(1 + next(200_000_000)), receivedOn: anyDay(2014, 40), inalienableYears: next(2) === 0 ? null : 1 + next(30), assets };
      if (!checkSubsidy(assets).ok) continue; // every residual at cost
      const schedule = releaseSchedule(s, startMonth);
      expect(schedule[0].from, `run ${run}`).toBe(fiscalYearOf(s.receivedOn, startMonth).from);
      expect(schedule.every((y) => y.release >= 0n), `run ${run}`).toBe(true);
      expect(sum(schedule.map((y) => y.release)), `run ${run}`).toBe(s.amount);
      for (const y of schedule) expect(yearEndRelease([s], y, startMonth)?.lines[0].debit ?? 0n, `run ${run}`).toBe(y.release);
    }
  });
});
