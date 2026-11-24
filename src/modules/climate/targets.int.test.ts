import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { CLIMATE_MUTATIONS as M } from "@/modules/climate/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-17T09:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

// Made-up numbers to exercise the rules, NOT husbandry targets (SPEC-m4 MQ1).
const band = { fromAge: 0, toAge: 10, temperatureMinTenths: 100, temperatureMaxTenths: 200, humidityMin: 40, humidityMax: 60, ammoniaMax: 10 };
const targets = (over: object = {}) => ({ id: uuidv7(), validFrom: "2026-11-01", source: "Guide d’élevage, éd. 2025, p. 12", bands: [band], ...over });

describe("climate targets through sync (SPEC-m4 CL1, §2)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => ([a, b] = await twoTenants()));

  it("the owner saves a dated version with its source; every member of the organisation pulls it, no one else", async () => {
    const set = targets();
    expect(await statuses(a, [m(M.saveTargets, set)])).toEqual(["applied"]);
    expect((await pull({ ...a, role: "worker" }, 0, registry)).changes.find((c) => c.id === set.id)?.data).toEqual({ ...set, productionType: null }); // for every type
    expect((await pull(b, 0, registry)).changes.some((c) => c.id === set.id)).toBe(false);
  });

  it("managers and workers may not set targets", async () => {
    expect(await statuses({ ...a, role: "manager" }, [m(M.saveTargets, targets())])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses({ ...a, role: "worker" }, [m(M.saveTargets, targets())])).toEqual(["errors.FORBIDDEN"]);
  });

  it("refuses a missing source, overlapping bands, and a version saved twice under one id", async () => {
    expect(await statuses(a, [m(M.saveTargets, targets({ source: "" }))])).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(a, [m(M.saveTargets, targets({ bands: [band, { ...band, fromAge: 10, toAge: 20 }] }))])).toEqual(["errors.TARGET_BANDS_OVERLAP"]);
    const set = targets();
    expect(await statuses(a, [m(M.saveTargets, set), m(M.saveTargets, set)])).toEqual(["applied", "errors.ALREADY_EXISTS"]);
    expect(await statuses(b, [m(M.saveTargets, set)])).toEqual(["errors.ALREADY_EXISTS"]); // never overwritten across organisations
  });
});
