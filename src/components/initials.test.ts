import { expect, it } from "vitest";
import { initials } from "@/components/initials";

it("the first letters of the first two words; none for a phone, an email or no name yet", () => {
  expect(initials("Karim Ben Ahmed")).toBe("KB");
  expect(initials("élodie martin")).toBe("ÉM");
  expect(initials("يوسف العلوي")).toBe("ي");
  expect(initials("Démo")).toBe("D");
  for (const none of ["+212612345678", "karim@example.ma", "", undefined]) expect(initials(none)).toBe("");
});
