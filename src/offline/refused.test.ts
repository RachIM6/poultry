import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { payloadSummary, redoHref, refusalContext } from "./refused";

const types = Object.keys(registry.mutations);
const label = (messages: typeof fr, type: string) => type.split(".").reduce<unknown>((node, k) => (node as Record<string, unknown>)?.[k], messages.Sync.types);

describe("refused writes (ADR-003 §7)", () => {
  // A new mutation type fails here until it has a label in both languages and a screen to redo it on.
  it.each(types)("%s has a label in fr and ar, and a screen", (type) => {
    expect(typeof label(fr, type)).toBe("string");
    expect(typeof label(ar, type)).toBe("string");
    const route = redoHref(type, {})!;
    expect(route).toMatch(/^\//);
    expect(existsSync(`src/app/[locale]/(app)${route}/page.tsx`)).toBe(true);
  });

  it("a batch write opens that batch; an unknown type has no screen", () => {
    expect(redoHref("flock.recordDay", { batchId: "b1", day: "2026-11-20" })).toBe("/batches#b1");
    expect(redoHref("sales.recordConsumption", { batchId: "b1", kind: "live" })).toBe("/batches#b1");
    expect(redoHref("sales.recordConsumption", { batchId: "b1", kind: "eggs" })).toBe("/eggs");
    expect(redoHref("sales.recordPayment", { buyerId: "x" })).toBe("/receivables");
    expect(redoHref("planning.placeFromPlan", { planId: "p", batch: { id: "b1" } })).toBe("/planning");
    expect(redoHref("test.unknown", {})).toBeUndefined();
  });

  it("names the house (through the batch) or the farm, and the day", () => {
    const records = [
      { key: "batch:b1", data: { id: "b1", houseId: "h1" } },
      { key: "house:h1", data: { id: "h1", name: "Bâtiment 2" } },
      { key: "farm:f1", data: { id: "f1", name: "Ferme Nord" } },
    ];
    expect(refusalContext({ id: "e", batchId: "b1", day: "2026-11-20", dead: 3 }, records)).toEqual({ place: "Bâtiment 2", day: "2026-11-20" });
    expect(refusalContext({ farmId: "f1", on: "2026-11-21" }, records)).toEqual({ place: "Ferme Nord", day: "2026-11-21" });
    expect(refusalContext({ planId: "p", batch: { houseId: "h1", placedOn: "2026-12-01" } }, records)).toEqual({ place: "Bâtiment 2", day: "2026-12-01" });
    expect(refusalContext({ batchId: "gone" }, records)).toEqual({ place: undefined, day: undefined });
    expect(refusalContext("not an object", records)).toEqual({ place: undefined, day: undefined });
  });

  it("sums up what was typed, without ids or empty fields, long values cut", () => {
    const payload = { id: "e", batchId: "b1", day: "2026-11-20", dead: 3, deathCause: "", note: null, vaccinated: false, feed: { stockItemId: "s", grams: 85_000 }, lines: [{ eggs: 30 }], staffIds: ["a"], file: "x".repeat(50) };
    expect(payloadSummary(payload)).toEqual(["day: 2026-11-20", "dead: 3", "vaccinated: false", "feed.grams: 85000", "lines.0.eggs: 30", `file: ${"x".repeat(40)}…`]);
    expect(payloadSummary(undefined)).toEqual([]);
  });
});
