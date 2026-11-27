import { expect, it } from "vitest";
import { NAME_MAX, Names } from "@/modules/identity/schema";

it("a first and a last name: trimmed, spaces collapsed, Latin or Arabic letters, the display name joined", () => {
  expect(Names.parse({ firstName: "  Karim ", lastName: "Ben   Ahmed" })).toEqual({ firstName: "Karim", lastName: "Ben Ahmed", name: "Karim Ben Ahmed" });
  expect(Names.parse({ firstName: "يوسف", lastName: "العلوي" })).toEqual({ firstName: "يوسف", lastName: "العلوي", name: "يوسف العلوي" });
  for (const [firstName, lastName] of [["Aït", "N’Ait-Ali"], ["Zoé", "D'Arc"], ["مُحَمَّد", "بن علي"], ["É".repeat(NAME_MAX), "O"]]) {
    expect(Names.safeParse({ firstName, lastName }).success, `${firstName} ${lastName}`).toBe(true);
  }
});

it("refuses an empty name, digits, markup or symbols, and a name over the cap", () => {
  for (const [firstName, lastName] of [
    ["", "Ben Ahmed"],
    ["Karim", "   "],
    ["Karim2", "Ben"],
    ["<b>Karim</b>", "Ben"],
    ["Karim", "Ben & Co"],
    ["-Karim", "Ben"],
    ["Karim", "Ben'"],
    ["x".repeat(NAME_MAX + 1), "Ben"],
    ["Karim​", "Ben"], // an invisible character
  ]) {
    expect(Names.safeParse({ firstName, lastName }).success, `${firstName} ${lastName}`).toBe(false);
  }
  expect(Names.safeParse({ firstName: 1, lastName: "Ben" }).success).toBe(false);
});
