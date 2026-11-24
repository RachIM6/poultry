import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { DOCUMENT_SOON_DAYS, byExpiry, documentState } from "./document";

const d = (s: string) => s as FarmDay;

// SPEC-m2-compliance DC3, §8 fixture (canvas, today 5 Nov 2026).
describe("document state", () => {
  it("expired, soon, valid or none, by the expiry date", () => {
    expect(DOCUMENT_SOON_DAYS).toBe(60);
    expect(documentState("2026-11-30", d("2026-11-05"))).toBe("soon");
    expect(documentState("2027-03-15", d("2026-11-05"))).toBe("valid");
    expect(documentState("2026-11-01", d("2026-11-05"))).toBe("expired");
    expect(documentState("2026-11-05", d("2026-11-05"))).toBe("soon"); // still valid today
    expect(documentState("2027-01-04", d("2026-11-05"))).toBe("soon"); // 60 days ahead
    expect(documentState("2027-01-05", d("2026-11-05"))).toBe("valid");
    expect(documentState(null, d("2026-11-05"))).toBe("none");
  });
  it("sorts the soonest expiry first, documents without one last", () => {
    const docs = [{ expiresOn: null }, { expiresOn: "2027-03-15" }, { expiresOn: "2026-11-30" }];
    expect(docs.sort(byExpiry).map((x) => x.expiresOn)).toEqual(["2026-11-30", "2027-03-15", null]);
  });
});
