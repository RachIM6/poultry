import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { accountingSettings, bankReconciliation, batchResults, budgetBases, yearEndCount } from "@/modules/finance";
import { tenant } from "@/test/tenant";

// Under load an interactive transaction waits for a pooled connection and, past maxWait, fails the page (P2028). The
// page reads run on the pool instead: each query takes a connection and gives it back at once.
describe("finance page reads run without an interactive transaction", () => {
  let owner: TenantContext;
  const transactions = vi.spyOn(db, "$transaction");

  beforeAll(async () => {
    owner = await tenant("+212600000071");
    transactions.mockClear(); // onboarding writes in one
  });

  afterEach(() => transactions.mockClear());

  it.each([
    ["batchResults", () => batchResults(owner)],
    ["budgetBases", () => budgetBases(owner)],
    ["yearEndCount", () => yearEndCount(owner, null)],
    ["accountingSettings", () => accountingSettings(owner)],
    ["bankReconciliation", () => bankReconciliation(owner)],
  ])("%s", async (_, read) => {
    expect((await read()).ok).toBe(true);
    expect(transactions).not.toHaveBeenCalled();
  });
});
