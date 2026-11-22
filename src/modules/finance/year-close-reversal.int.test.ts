import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closeFiscalYear, createFixedAsset, readBooks, reopenFiscalYear, runClose, updateFixedAsset } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// SPEC-finance FCX5: the reversal mechanism, before T108 and T109 add the kinds it is for. Depreciation is never
// reversed in the product; here, and only in this file, it stands in for a reversible kind.
vi.mock("@/modules/finance/domain/close", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/finance/domain/close")>()),
  REVERSED_AT_OPENING: { depreciation: true },
}));

const clock = fixedClock("2028-06-15T10:00:00Z");
const jan1 = new Date("2027-01-01T00:00:00Z");

describe("the opening reversals of the reversible close kinds (SPEC-finance FCX5, T104)", () => {
  let owner: TenantContext, entity: string, assetId: string;
  const reversal = () => `reversal:close:depreciation:${entity}:2026`;

  /** Every line posted on 1 Jan 2027 for the reversal's source, its versions and their cancellations: [label, version, account, debit, credit]. */
  async function reversalLines() {
    const ids = (await db.journalEntry.findMany({ where: { sourceId: reversal() }, select: { id: true } })).map((e) => e.id);
    const lines = await db.journalLine.findMany({
      where: { entry: { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] } },
      include: { entry: true },
      orderBy: [{ entry: { id: "asc" } }, { debitCentimes: "desc" }],
    });
    return lines.map((l) => [l.entry.label, l.entry.sourceVersion, l.entry.journal, l.entry.day.toISOString().slice(0, 10), l.account, l.debitCentimes, l.creditCentimes]);
  }

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    owner = await tenant("+212600000001", "Ferme A");
    entity = (await listLegalEntities(owner))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    assetId = uuidv7();
    // §7.1 A's generator: 2 254,76 of depreciation in 2026.
    const generator = { id: assetId, label: "Groupe électrogène", category: "equipment", acquiredOn: "2026-09-18", inServiceOn: "2026-09-18", amountCentimes: "4735000", lifeMonths: 84, paidWith: "cash" };
    expect(await createFixedAsset(owner, generator, clock)).toEqual({ ok: true, value: undefined });
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 });
  });

  it("posts the reversal once, OD on the next year's first day, with the à-nouveaux; a second close posts nothing", async () => {
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 2 });
    expect(await reversalLines()).toEqual([
      ["Extourne des écritures de clôture", 1, "OD", "2027-01-01", "2833", 225_476n, 0n],
      ["Extourne des écritures de clôture", 1, "OD", "2027-01-01", "6193", 0n, 225_476n],
    ]);
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await db.journalEntry.count({ where: { legalEntityId: entity, day: jan1 } })).toBe(2);
    const books = await readBooks(owner, "2027-01");
    expect(books).toMatchObject({ ok: true, value: { trialBalance: { balanced: true } } });
  });

  it("posts it again by reversal and new version when the close entry changed after the next year was opened", async () => {
    expect(await updateFixedAsset(owner, { assetId, lifeMonths: 60, residualCentimes: "0" })).toEqual({ ok: true, value: undefined });
    expect(await reopenFiscalYear(owner, { year: 2026 })).toEqual({ ok: true, value: undefined });
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 2 });
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 4 }); // à-nouveaux and reversal: each cancelled, then version 2
    expect(await reversalLines()).toEqual([
      ["Extourne des écritures de clôture", 1, "OD", "2027-01-01", "2833", 225_476n, 0n],
      ["Extourne des écritures de clôture", 1, "OD", "2027-01-01", "6193", 0n, 225_476n],
      ["Annulation", null, "OD", "2027-01-01", "6193", 225_476n, 0n],
      ["Annulation", null, "OD", "2027-01-01", "2833", 0n, 225_476n],
      ["Extourne des écritures de clôture", 2, "OD", "2027-01-01", "2833", 315_667n, 0n],
      ["Extourne des écritures de clôture", 2, "OD", "2027-01-01", "6193", 0n, 315_667n],
    ]);
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
    // 2027 opens on the 2026 closing, then the reversal takes the depreciation back out of the balance sheet.
    const books = await readBooks(owner, "2027-01");
    if (!books.ok) throw new Error(books.error);
    expect(books.value.trialBalance?.balanced).toBe(true);
    expect(books.value.trialBalance?.rows.filter((r) => ["2833", "6193", "1199"].includes(r.account)).map((r) => [r.account, r.balance])).toEqual([
      ["1199", 315_667n],
      ["2833", 0n],
      ["6193", -315_667n],
    ]);
  });
});
