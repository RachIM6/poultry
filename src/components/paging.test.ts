import { describe, expect, it } from "vitest";
import { pageOf, pageWindow, pickTab } from "@/components/paging";

const _ = null;

describe("pageWindow", () => {
  it("shows every page when there are few", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 2)).toEqual([1, 2]);
    expect(pageWindow(2, 2)).toEqual([1, 2]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]); // each gap would hide one page: shown instead
  });

  it("keeps the first, the last and the current page's neighbours", () => {
    expect(pageWindow(1, 7)).toEqual([1, 2, _, 7]);
    expect(pageWindow(7, 7)).toEqual([1, _, 6, 7]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, _, 7]);
    expect(pageWindow(5, 12)).toEqual([1, _, 4, 5, 6, _, 12]);
    expect(pageWindow(1, 50)).toEqual([1, 2, _, 50]);
    expect(pageWindow(25, 50)).toEqual([1, _, 24, 25, 26, _, 50]);
    expect(pageWindow(50, 50)).toEqual([1, _, 49, 50]);
  });

  it("is empty without pages", () => {
    expect(pageWindow(1, 0)).toEqual([]);
  });
});

describe("pageOf", () => {
  it("reads ?page= between the first and the last page", () => {
    expect(pageOf("3", 132, 25)).toBe(3);
    expect(pageOf(undefined, 132, 25)).toBe(1);
    expect(pageOf(["2", "3"], 132, 25)).toBe(1); // ?page=2&page=3
    expect(pageOf("0", 132, 25)).toBe(1);
    expect(pageOf("-2", 132, 25)).toBe(1);
    expect(pageOf("2.5", 132, 25)).toBe(1);
    expect(pageOf("99", 132, 25)).toBe(6);
    expect(pageOf("2", 0, 25)).toBe(1); // nothing to page
  });
});

describe("pickTab", () => {
  it("takes a known ?tab=, else the first tab", () => {
    const keys = ["open", "closed"] as const;
    expect(pickTab(keys, "closed")).toBe("closed");
    expect(pickTab(keys, undefined)).toBe("open");
    expect(pickTab(keys, "nope")).toBe("open");
    expect(pickTab(keys, ["closed"])).toBe("open"); // ?tab=closed&tab=closed
  });
});
