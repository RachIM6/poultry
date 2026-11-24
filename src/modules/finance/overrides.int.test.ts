import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push, recordChange } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { chartView, postingOverrides, postPending, setPostingOverride } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-finance FN8: the owner's per-entity override of a default rule's account, for new entries only, audited.
const m = (type: string, payload: unknown) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-01T08:00:00+01:00" });
const OK = { ok: true, value: undefined };
const accountsOf = async (where: object) =>
  (await db.journalLine.findMany({ where: { entry: where }, orderBy: [{ entry: { createdAt: "asc" } }, { account: "asc" }] })).map((l) => [l.account, l.debitCentimes, l.creditCentimes]);

describe("posting overrides (SPEC-finance FN8)", () => {
  let a: TenantContext, b: TenantContext;
  const ids = { farm: uuidv7(), supplier: uuidv7(), feed: uuidv7(), box: uuidv7(), before: uuidv7() };
  const purchase = (id: string) =>
    m("inventory.recordPurchase", { id, movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: "2026-03-02", quantity: 2_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null });
  const pushed = async (ctx: TenantContext, ...ms: ReturnType<typeof m>[]) => expect((await push(ctx, ms, registry)).results.map((r) => r.status)).toEqual(ms.map(() => "applied"));

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [a, b] = await twoTenants();
    await pushed(
      a,
      m("farm-registry.createFarm", { id: ids.farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
      m("inventory.createStockItem", { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null }),
      m("finance.createTreasuryAccount", { id: ids.box, kind: "cash", name: "Caisse ferme" }),
      purchase(ids.before), // posted before any override
    );
    expect(await postPending(a)).toBe(1);
  });

  it("is the owner's alone", async () => {
    for (const role of ["manager", "accountant", "worker"] as const) {
      expect(await setPostingOverride({ ...a, role }, { ruleAccount: "612122", account: "61213" }), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await postingOverrides({ ...a, role }), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await db.postingOverride.count()).toBe(0);
  });

  it("refuses an account that isn't a posting account of the chart, of another class, or a rule that can't move", async () => {
    expect(await setPostingOverride(a, { ruleAccount: "612122", account: "61212" })).toEqual({ ok: false, error: "UNKNOWN_ACCOUNT" }); // has sub-accounts (FN4)
    expect(await setPostingOverride(a, { ruleAccount: "612122", account: "699999" })).toEqual({ ok: false, error: "UNKNOWN_ACCOUNT" });
    expect(await setPostingOverride(a, { ruleAccount: "612122", account: "712121" })).toEqual({ ok: false, error: "WRONG_ACCOUNT_CLASS" });
    expect(await setPostingOverride(a, { ruleAccount: "4411", account: "4415" })).toEqual({ ok: false, error: "NOT_OVERRIDABLE" });
    expect(await setPostingOverride(a, { ruleAccount: "612122", account: "6x" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await db.postingOverride.count()).toBe(0);
    expect(await db.auditEvent.count({ where: { entity: "PostingOverride" } })).toBe(0);
  });

  it("posts new entries on the override, audited; an entry already posted keeps its account", async () => {
    expect(await setPostingOverride(a, { ruleAccount: "612122", account: "61213" })).toEqual(OK);
    expect(await setPostingOverride(a, { ruleAccount: "612122", account: "61213" })).toEqual(OK); // the same again: nothing new
    expect(await db.postingOverride.count()).toBe(1);
    const [entity] = await db.legalEntity.findMany({ where: { organizationId: a.organizationId } });
    expect(await db.auditEvent.findMany({ where: { entity: "PostingOverride" } })).toEqual([
      expect.objectContaining({ userId: a.userId, entityId: entity.id, action: "set", before: { ruleAccount: "612122", account: null }, after: { ruleAccount: "612122", account: "61213" } }),
    ]);

    const after = uuidv7();
    await pushed(a, purchase(after));
    expect(await postPending(a)).toBe(1);
    expect(await accountsOf({ sourceId: after })).toEqual([["4411", 0n, 900_000n], ["61213", 900_000n, 0n]]);
    expect(await accountsOf({ sourceId: ids.before })).toEqual([["4411", 0n, 900_000n], ["612122", 900_000n, 0n]]); // untouched

    // A quick expense goes through the same overrides.
    expect(await setPostingOverride(a, { ruleAccount: "612512", account: "61228" })).toEqual(OK);
    const expense = m("finance.recordExpense", { id: uuidv7(), day: "2026-03-10", category: "electricity", amountCentimes: "120000", paidFrom: "cash", treasuryId: ids.box, note: null });
    await pushed(a, expense);
    expect(await accountsOf({ sourceId: (expense.payload as { id: string }).id })).toEqual([["5161", 0n, 120_000n], ["61228", 120_000n, 0n]]);

    const view = await postingOverrides(a);
    if (!view.ok || !view.value) throw new Error("no view");
    expect(view.value.rows.find((r) => r.op === "feed")).toMatchObject({ ruleAccount: "612122", default: { number: "612122" }, override: { number: "61213", applies: true } });
    expect(view.value.rows.find((r) => r.op === "expense.water")).toMatchObject({ ruleAccount: "612511", override: null });
    expect(view.value.choices.every((c) => /^[67]/.test(c.number))).toBe(true);

    // The chart screen shows it to the manager too, read-only.
    const chart = await chartView({ ...a, role: "manager" });
    if (!chart.ok) throw new Error(chart.error);
    expect(chart.value.rows.find((r) => r.op === "feed")).toMatchObject({ pca: { number: "612122" }, override: { number: "61213" } });
    expect(chart.value.rows.find((r) => r.op === "expense.water")?.override).toBeNull();
  });

  it("posts a later version of a source posted before the override on its first accounts (FN7)", async () => {
    // M1 has no purchase edit: a newer version in the change log stands for one (paid in full afterwards).
    const p = await db.purchase.findUniqueOrThrow({ where: { id: ids.before } });
    await db.$transaction((tx) =>
      recordChange(tx, a, "purchase", p.id, { id: p.id, farmId: p.farmId, supplierId: p.supplierId, stockItemId: p.stockItemId, day: "2026-03-02", quantity: p.quantity, unitPriceCentimes: "450", amountCentimes: "900000", paidCentimes: "900000", dueOn: null }),
    );
    expect(await postPending(a)).toBe(2); // the reversal and the new version
    const latest = await db.journalEntry.findFirstOrThrow({ where: { sourceId: ids.before }, orderBy: { sourceVersion: "desc" } });
    expect((await accountsOf({ id: latest.id })).map(([account]) => account)).toEqual(["5161", "612122"]);
    expect(await db.journalLine.count({ where: { entry: { sourceId: ids.before }, account: "61213" } })).toBe(0);
  });

  it("goes back to the default for new entries when reset, and leaves the other organisation alone", async () => {
    expect(await setPostingOverride(a, { ruleAccount: "612122", account: null })).toEqual(OK);
    expect(await db.auditEvent.findFirst({ where: { entity: "PostingOverride" }, orderBy: { id: "desc" } })).toMatchObject({ before: { ruleAccount: "612122", account: "61213" }, after: { ruleAccount: "612122", account: null } });
    const later = uuidv7();
    await pushed(a, purchase(later));
    await postPending(a);
    expect((await accountsOf({ sourceId: later })).map(([account]) => account)).toEqual(["4411", "612122"]);

    const view = await postingOverrides(b);
    if (!view.ok || !view.value) throw new Error("no view");
    expect(view.value.rows.every((r) => r.override === null)).toBe(true);
    expect(await db.postingOverride.count({ where: { organizationId: b.organizationId } })).toBe(0);
  });
});
