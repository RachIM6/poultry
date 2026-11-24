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

  // The forms' own labels (plain messages: no ICU here), in both languages.
  const translator = (messages: typeof fr) => (key: string, values: Record<string, string> = {}) =>
    String(key.split(".").reduce<unknown>((node, k) => (node as Record<string, unknown>)[k], messages)).replace(/\{(\w+)\}/g, (_, k: string) => values[k]);
  // Intl puts narrow no-break spaces in numbers and amounts.
  const summary = (...args: Parameters<typeof payloadSummary>) => payloadSummary(...args).map((line) => line.replace(/\s/g, " "));
  const records = [
    { key: "buyer:u1", data: { id: "u1", name: "Hassan" } },
    { key: "stockItem:s1", data: { id: "s1", name: "Démarrage" } },
  ];

  it("says what was typed in the form's words and units, without bare ids or empty fields", () => {
    const day = { id: "e", batchId: "b1", day: "2026-11-20", changes: { dead: 3, deathCause: "heat", culled: 0, feed: { stockItemId: "s1", grams: 85_500 }, waterMl: 120_000, note: "" } };
    expect(summary(day, records, translator(fr), "fr")).toEqual([
      "Jour : 20 novembre 2026",
      "Morts : 3",
      "Cause : Chaleur",
      "Réformés (éliminés) : 0",
      "Article : Démarrage",
      "Aliment : 85,5 kg",
      "Eau : 120,0 L",
    ]);
    expect(summary(day, records, translator(ar), "ar")).toContain("النافق: 3");
  });

  it("reads money in DH and weights in kg; an unknown field keeps its name, an unknown id is left out", () => {
    const sale = { id: "x", batchId: "b1", buyerId: "u1", birds: 200, farmWeightGrams: 500_000, pricePerKgCentimes: "1850", takenBy: "owner", staffIds: ["a"], payment: { treasuryId: "t", dueOn: "2026-12-01" }, file: "x".repeat(50) };
    expect(summary(sale, records, translator(fr), "fr")).toEqual([
      "Acheteur : Hassan",
      "Nombre d’oiseaux : 200",
      "Poids total à la ferme : 500 kg",
      "Prix au kg (DH) : 18,50 DH",
      "takenBy : owner",
      "payment.dueOn : 1 décembre 2026",
      `file : ${"x".repeat(40)}…`,
    ]);
    expect(summary({ sample: { weightsGrams: [2_100, 2_250] } }, [], translator(fr), "fr")).toEqual(["Poids : 2,1 kg, 2,25 kg"]);
    expect(summary({ buyerId: "gone" }, [], translator(fr), "fr")).toEqual([]);
    expect(summary(undefined, [], translator(fr), "fr")).toEqual([]);
  });
});
