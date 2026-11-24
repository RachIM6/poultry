import { expect, it } from "vitest";
import { pick } from "./pick";

const messages = { Farms: { saved: "Enregistré", title: "Fermes" }, Stock: { units: { kg: "kg", l: "L" }, item: "Article" }, Nav: { back: "Retour" } };

it("keeps whole namespaces, single keys and groups, nothing else", () => {
  expect(pick(messages, ["Nav", "Farms.saved", "Stock.units"])).toEqual({ Nav: { back: "Retour" }, Farms: { saved: "Enregistré" }, Stock: { units: { kg: "kg", l: "L" } } });
});

it("merges keys of the same namespace", () => {
  expect(pick(messages, ["Farms.saved", "Farms.title"])).toEqual({ Farms: { saved: "Enregistré", title: "Fermes" } });
});

it("throws on a path that isn't in the catalogue", () => {
  expect(() => pick(messages, ["Farms.nope"])).toThrow("Farms.nope");
  expect(() => pick(messages, ["Sale"])).toThrow("Sale");
  expect(() => pick(messages, ["Nav.back.deeper"])).toThrow("Nav.back.deeper");
});
