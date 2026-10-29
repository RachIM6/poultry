import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Guards the CAPABILITY-MAP boundary rule in eslint.config.mjs.
const eslint = new ESLint();

async function boundaryErrors(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: file });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

describe("module boundaries", () => {
  it("allows a declared dependency through its index", async () => {
    expect(await boundaryErrors("src/modules/flock/x.ts", 'export * from "@/modules/inventory";')).toEqual([]);
    expect(await boundaryErrors("src/modules/flock/x.ts", 'export * from "@/modules/inventory/index";')).toEqual([]);
  });

  it("allows deep imports inside the same module", async () => {
    expect(await boundaryErrors("src/modules/flock/a/b.ts", 'export * from "@/modules/flock/kpi";')).toEqual([]);
  });

  it("rejects deep imports into another module", async () => {
    expect(await boundaryErrors("src/modules/flock/x.ts", 'export * from "@/modules/inventory/service";')).not.toEqual([]);
  });

  it("rejects modules that are not declared dependencies", async () => {
    expect(await boundaryErrors("src/modules/flock/x.ts", 'export * from "@/modules/sales";')).not.toEqual([]);
  });

  it("rejects parent-relative imports inside modules", async () => {
    expect(await boundaryErrors("src/modules/flock/x.ts", 'export * from "../sales";')).not.toEqual([]);
  });

  it("keeps domain/ pure but still applies module boundaries there", async () => {
    const domain = "src/modules/flock/domain/batch.ts";
    expect(await boundaryErrors(domain, 'export * from "@/lib/kernel/result";')).toEqual([]);
    expect(await boundaryErrors(domain, 'export * from "@/modules/inventory";')).toEqual([]);
    for (const bad of ["next/headers", "react", "@prisma/client", "node:crypto", "crypto", "@/lib/db", "@/modules/flock/infrastructure/repo", "@/modules/sales"]) {
      expect(await boundaryErrors(domain, `export * from "${bad}";`), bad).not.toEqual([]);
    }
    expect(await boundaryErrors("src/modules/flock/infrastructure/repo.ts", 'export * from "@prisma/client";')).toEqual([]);
  });

  it("forbids the system clock in domain and application code", async () => {
    const clockErrors = async (file: string, code: string) => {
      const [result] = await eslint.lintText(code, { filePath: file });
      return result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    };
    expect(await clockErrors("src/modules/flock/domain/a.ts", "export const t = new Date();")).not.toEqual([]);
    expect(await clockErrors("src/modules/flock/application/a.ts", "export const t = Date.now();")).not.toEqual([]);
    expect(await clockErrors("src/modules/flock/domain/a.ts", 'export const t = new Date("2026-01-01");')).toEqual([]);
    expect(await clockErrors("src/modules/flock/infrastructure/a.ts", "export const t = new Date();")).toEqual([]);
  });

  it("rejects deep module imports from app code and any module import from lib", async () => {
    expect(await boundaryErrors("src/app/page.tsx", 'export * from "@/modules/flock/kpi";')).not.toEqual([]);
    expect(await boundaryErrors("src/app/page.tsx", 'export * from "@/modules/flock";')).toEqual([]);
    // ADR-008: schema.ts is the second public entry, for the offline client.
    expect(await boundaryErrors("src/components/form.tsx", 'export * from "@/modules/flock/schema";')).toEqual([]);
    expect(await boundaryErrors("src/modules/health/x.ts", 'export * from "@/modules/flock/schema";')).toEqual([]);
    expect(await boundaryErrors("src/modules/health/x.ts", 'export * from "@/modules/sales/schema";')).not.toEqual([]); // not a dependency
    expect(await boundaryErrors("src/lib/db.ts", 'export * from "@/modules/flock";')).not.toEqual([]);
  });
});
