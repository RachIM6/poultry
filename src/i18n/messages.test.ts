import { expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";

// SPEC §9: 0 missing keys in ar or fr. Runs in CI with the unit tests.
const keys = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

it("ar.json and fr.json have the same keys", () => {
  expect({ missingInFr: keys(ar).filter((k) => !keys(fr).includes(k)) }).toEqual({ missingInFr: [] });
  expect({ missingInAr: keys(fr).filter((k) => !keys(ar).includes(k)) }).toEqual({ missingInAr: [] });
});
