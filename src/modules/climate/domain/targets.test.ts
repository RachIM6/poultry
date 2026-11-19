import { describe, expect, it } from "vitest";
import { checkBands, outOfRange, setOn, targetFor, verdicts, type Band, type TargetSet } from "@/modules/climate/domain/targets";

// Made-up numbers to exercise the rules, NOT husbandry targets: real ones come from the owner's source (SPEC-m4 MQ1).
const band = (b: Partial<Band>): Band => ({ fromAge: 0, toAge: 10, temperatureMinTenths: 100, temperatureMaxTenths: 200, humidityMin: 40, humidityMax: 60, ammoniaMax: 10, ...b });
const set = (id: string, validFrom: string, bands: Band[]): TargetSet => ({ id, validFrom, source: "test", bands });

describe("climate targets (SPEC-m4 CL1)", () => {
  const sets = [set("01", "2026-01-01", [band({ fromAge: 0, toAge: 10 }), band({ fromAge: 11, toAge: 20, temperatureMaxTenths: 150 })]), set("02", "2026-06-01", [band({ fromAge: 0, toAge: 30, humidityMax: 70 })])];

  it("the set in force is the latest valid on or before the day; none before the first", () => {
    expect(setOn(sets, "2025-12-31")).toBeNull();
    expect(setOn(sets, "2026-05-31")?.id).toBe("01");
    expect(setOn(sets, "2026-06-01")?.id).toBe("02");
    expect(setOn([...sets, set("03", "2026-06-01", [])], "2026-06-02")?.id).toBe("03"); // saved later the same day
  });

  it("the band covering the batch's age, or none outside every band", () => {
    expect(targetFor(sets, "2026-03-01", 15)?.temperatureMaxTenths).toBe(150);
    expect(targetFor(sets, "2026-03-01", 21)).toBeNull();
    expect(targetFor(sets, "2026-07-01", 21)?.humidityMax).toBe(70);
    expect(targetFor([], "2026-07-01", 3)).toBeNull();
  });

  it("refuses overlapping bands and bands that read backwards", () => {
    expect(checkBands([band({ fromAge: 0, toAge: 10 }), band({ fromAge: 10, toAge: 20 })])).toEqual({ ok: false, error: "TARGET_BANDS_OVERLAP" });
    expect(checkBands([band({ fromAge: 5, toAge: 4 })])).toEqual({ ok: false, error: "INVALID_BAND" });
    expect(checkBands([band({ humidityMin: 70, humidityMax: 60 })])).toEqual({ ok: false, error: "INVALID_BAND" });
    expect(checkBands([band({ fromAge: 11, toAge: 20 }), band({ fromAge: 0, toAge: 10, temperatureMinTenths: null })])).toEqual({ ok: true, value: undefined });
  });
});

describe("a reading's verdicts (SPEC-m4 CL3, CL4)", () => {
  const b = band({});
  it("below, within or above each bound; ammonia has a maximum only", () => {
    expect(verdicts({ temperatureTenths: 99, humidity: 40, ammonia: 10 }, b)).toEqual({ temperature: "below", humidity: "within", ammonia: "within" });
    expect(verdicts({ temperatureTenths: 201, humidity: 61, ammonia: 11 }, b)).toEqual({ temperature: "above", humidity: "above", ammonia: "above" });
    expect(outOfRange(verdicts({ temperatureTenths: 150, humidity: 50, ammonia: null }, b))).toBe(false);
    expect(outOfRange(verdicts({ temperatureTenths: 250, humidity: 50, ammonia: null }, b))).toBe(true);
  });

  it("no target, no bound or no value: none, and no alert", () => {
    expect(verdicts({ temperatureTenths: 400, humidity: 99, ammonia: 99 }, null)).toEqual({ temperature: "none", humidity: "none", ammonia: "none" });
    expect(verdicts({ temperatureTenths: 400, humidity: 99, ammonia: null }, band({ temperatureMinTenths: null, temperatureMaxTenths: null, humidityMin: null, humidityMax: null, ammoniaMax: null }))).toEqual({ temperature: "none", humidity: "none", ammonia: "none" });
    expect(outOfRange(verdicts({ temperatureTenths: 400, humidity: 99, ammonia: 99 }, null))).toBe(false);
  });
});
