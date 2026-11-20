import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, checkFile } from "./file";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

// SPEC-m2-compliance DC2, D4: the type comes from the bytes, never from the name or the client's header.
describe("checkFile", () => {
  it("recognises PDF, JPEG, PNG and WebP by their first bytes", () => {
    expect(checkFile(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toEqual({ ok: true, value: "application/pdf" });
    expect(checkFile(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ ok: true, value: "image/jpeg" });
    expect(checkFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ ok: true, value: "image/png" });
    expect(checkFile(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toEqual({ ok: true, value: "image/webp" });
  });
  it("refuses anything else, an empty file, and more than the cap", () => {
    expect(checkFile(new TextEncoder().encode("<svg onload=alert(1)>"))).toEqual({ ok: false, error: "FILE_TYPE_NOT_ALLOWED" });
    expect(checkFile(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toEqual({ ok: false, error: "FILE_TYPE_NOT_ALLOWED" }); // RIFF WAVE
    expect(checkFile(new Uint8Array(0))).toEqual({ ok: false, error: "FILE_TYPE_NOT_ALLOWED" });
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(checkFile(big)).toEqual({ ok: false, error: "FILE_TOO_LARGE" });
  });
});
