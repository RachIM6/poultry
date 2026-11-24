import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-finance FN2, FN6: a quick expense's PCA account lands in the entity's chart, as the posting pipeline's rules do.
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "finance", sourceId } }, include: { entry: true }, orderBy: [{ debitCentimes: "desc" }, { account: "asc" }] })).map((l) => [
    l.entry.journal,
    l.account,
    l.debitCentimes,
    l.creditCentimes,
  ]);

describe("quick expenses in the entity's chart (FN2)", () => {
  let noPca: TenantContext, withPca: TenantContext;

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((a) => ({ chart: a.chart, number: a.number, label: a.label, parentNumber: a.parent, fallback: a.fallback })) });
    [noPca, withPca] = await twoTenants();
    expect(await changeAccountingChoices(noPca, (await listLegalEntities(noPca))[0].id, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1, vatRegistered: true })).toMatchObject({ ok: true });
  });

  const record = async (ctx: TenantContext) => {
    const ids = { box: uuidv7(), bank: uuidv7(), power: uuidv7(), catching: uuidv7(), transfer: uuidv7() };
    const pushed = await push(
      ctx,
      [
        m("finance.createTreasuryAccount", { id: ids.box, kind: "cash", name: "Caisse" }),
        m("finance.createTreasuryAccount", { id: ids.bank, kind: "bank", name: "Banque" }),
        // electricity 1 200,00 of which 200,00 VAT, from the cash box; the catching crew 800,00 on credit
        m("finance.recordExpense", { id: ids.power, day: "2026-03-02", category: "electricity", amountCentimes: "120000", vatCentimes: "20000", paidFrom: "cash", treasuryId: ids.box, note: null }),
        m("finance.recordExpense", { id: ids.catching, day: "2026-03-03", category: "catching", amountCentimes: "80000", paidFrom: "credit", treasuryId: null, note: null }),
        m("finance.recordTransfer", { id: ids.transfer, day: "2026-03-04", fromId: ids.box, toId: ids.bank, amountCentimes: "50000" }),
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
    return ids;
  };

  it("posts on the CGNC fallback with the PCA off: 612512 → 6125, 612612 → 6126", async () => {
    const ids = await record(noPca);
    expect(await linesOf(ids.power)).toEqual([
      ["CA", "6125", 100_000n, 0n],
      ["CA", "34552", 20_000n, 0n],
      ["CA", "5161", 0n, 120_000n],
    ]);
    expect(await linesOf(ids.catching)).toEqual([
      ["AC", "6126", 80_000n, 0n],
      ["AC", "4411", 0n, 80_000n],
    ]);
    expect(await db.journalEntry.count({ where: { sourceModule: "finance", sourceId: ids.transfer } })).toBe(2); // 5115: in both charts
  });

  it("keeps the PCA accounts with the PCA on", async () => {
    const ids = await record(withPca);
    expect((await linesOf(ids.power)).map((l) => l[1])).toEqual(["612512", "5161"]); // not VAT-registered: the whole total
    expect((await linesOf(ids.catching)).map((l) => l[1])).toEqual(["612612", "4411"]);
  });
});
