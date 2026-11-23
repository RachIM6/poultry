import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, closeFiscalYear, closePreview, runClose, saveYearEndCount, saveYearEndValues, yearEndCount } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

const clock = fixedClock("2028-06-15T10:00:00Z");
const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-11-05T08:00:00+01:00" });
const purchase = (supplierId: string, stockItemId: string, day: string, quantity: number, unitPriceCentimes: string, vatCentimes = "0") =>
  m("inventory.recordPurchase", { id: uuidv7(), movementId: uuidv7(), supplierId, stockItemId, day, quantity, unitPriceCentimes, paidCentimes: "0", vatCentimes, dueOn: null });
const item = (id: string, farmId: string, kind: string, name: string, unit: string, lot: string | null = null, expiresOn: string | null = null) =>
  m("inventory.createStockItem", { id, farmId, productId: null, kind, name, unit, lot, expiresOn });

/** Every line posted for a source, its versions and their cancellations: [day, account, debit, credit]. */
async function linesOf(sourceId: string) {
  const ids = (await db.journalEntry.findMany({ where: { sourceModule: "finance", sourceId }, select: { id: true } })).map((e) => e.id);
  const lines = await db.journalLine.findMany({ where: { entry: { OR: [{ id: { in: ids } }, { reversesId: { in: ids } }] } }, include: { entry: true }, orderBy: [{ entry: { id: "asc" } }, { debitCentimes: "desc" }, { account: "asc" }] });
  return lines.map((l) => [l.entry.day.toISOString().slice(0, 10), l.account, l.debitCentimes, l.creditCentimes]);
}

describe("stocks at the close (SPEC-finance FC5, FQ20, T108)", () => {
  let owner: TenantContext, other: TenantContext, entity: string, otherEntity: string;
  const ids = { farm: uuidv7(), supplier: uuidv7(), feed: uuidv7(), found: uuidv7(), otherFarm: uuidv7(), otherSupplier: uuidv7(), feed2: uuidv7(), vaccine: uuidv7(), gas: uuidv7() };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    owner = await tenant("+212600000001", "Ferme A");
    other = await tenant("+212600000002", "Ferme B");
    entity = (await listLegalEntities(owner))[0].id;
    otherEntity = (await listLegalEntities(other))[0].id;
    expect(await changeAccountingChoices(owner, entity, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    // FN2: CGNC only; FN9: VAT-registered, so its purchases are valued without their VAT.
    expect(await changeAccountingChoices(other, otherEntity, { books: "ledger", pcaOverlay: false, fiscalYearStartMonth: 1, vatRegistered: true })).toMatchObject({ ok: true });

    const mine = await push(
      owner,
      [
        m("farm-registry.createFarm", { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("inventory.createSupplier", { id: ids.supplier, name: "Alf", phone: null }),
        item(ids.feed, ids.farm, "feed", "Croissance", "kg"),
        item(ids.found, ids.farm, "litter", "Paille", "kg"),
        // §7: 20 t of feed for 98 400,00 at two prices, 4,92 DH/kg on average on 31 December.
        purchase(ids.supplier, ids.feed, "2026-03-01", 10_000_000, "480"),
        purchase(ids.supplier, ids.feed, "2026-10-01", 10_000_000, "504"),
        purchase(ids.supplier, ids.feed, "2027-01-02", 10_000_000, "600"), // after the count day
        m("inventory.adjustStock", { id: uuidv7(), stockItemId: ids.found, day: "2026-06-01", quantity: 500_000, reason: "trouvée" }), // never bought
      ],
      registry,
    );
    const theirs = await push(
      other,
      [
        m("farm-registry.createFarm", { id: ids.otherFarm, name: "Ferme Rif", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("inventory.createSupplier", { id: ids.otherSupplier, name: "Véto", phone: null }),
        item(ids.feed2, ids.otherFarm, "feed", "Démarrage", "kg"),
        item(ids.vaccine, ids.otherFarm, "vaccine", "HB1", "dose", "L7", "2027-06-30"),
        item(ids.gas, ids.otherFarm, "gas", "Propane", "unit"),
        purchase(ids.otherSupplier, ids.feed2, "2026-09-01", 1_000_000, "500"), // 5 000,00
        purchase(ids.otherSupplier, ids.vaccine, "2026-09-01", 1000, "240", "40000"), // 2 400,00, of which 400,00 VAT
        purchase(ids.otherSupplier, ids.gas, "2026-09-01", 30, "5000"), // 1 500,00
      ],
      registry,
    );
    expect([...mine.results, ...theirs.results].filter((r) => r.status !== "applied")).toEqual([]);
  });

  it("§7 stockAtCloseValue: 98 400,00 at cost, the owner's 97 300,00, a provision of 1 100,00; the 2 January purchase changes nothing", async () => {
    expect(await saveYearEndValues(owner, { year: 2026, values: { [ids.feed]: "97 300" } })).toEqual({ ok: true, value: 1 });
    const preview = await closePreview(owner, 2026, clock);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.value.entries.slice(2)).toEqual([
      {
        kind: "stock",
        action: "post",
        lines: [
          { account: "3121", label: "Matières premières", debit: 9_840_000n, credit: 0n },
          { account: "612412", label: "Variation des stocks de matières premières Agricoles – Animaux", debit: 0n, credit: 9_840_000n },
        ],
      },
      { kind: "batch", action: "none", lines: [] },
      {
        kind: "provision",
        action: "post",
        lines: [
          { account: "61961", label: "D.E.P. pour dépréciation des stocks", debit: 110_000n, credit: 0n },
          { account: "3912", label: "Provisions pour dépréciation des matières et fournitures", debit: 0n, credit: 110_000n },
        ],
      },
    ]);
    // The lines, the litter found with no purchase cost listed, not valued (and not failing the run).
    expect(preview.value.stocks.map((l) => [l.name, l.farm, l.quantity, l.cost, l.current, l.value, l.provision])).toEqual([
      ["Croissance", "Ferme Atlas", 20_000_000, 9_840_000n, 9_730_000n, 9_730_000n, 110_000n],
      ["Paille", "Ferme Atlas", 500_000, null, null, 0n, 0n],
    ]);
    expect(preview.value.frozen).toBe(false);

    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 2 });
    expect(await linesOf(`close:stock:${entity}:2026`)).toEqual([["2026-12-31", "3121", 9_840_000n, 0n], ["2026-12-31", "612412", 0n, 9_840_000n]]);
    expect(await linesOf(`close:provision:${entity}:2026`)).toEqual([["2026-12-31", "61961", 110_000n, 0n], ["2026-12-31", "3912", 0n, 110_000n]]);
    const entry = await db.journalEntry.findFirstOrThrow({ where: { sourceId: `close:stock:${entity}:2026` } });
    expect(entry).toMatchObject({ journal: "OD", label: "Stocks de fin d’exercice", sourceVersion: 1, createdBy: owner.userId });
    expect(await runClose(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 }); // the same facts
    expect(await closePreview(owner, 2026, clock)).toMatchObject({ ok: true, value: { frozen: true, entries: [{}, {}, { action: "unchanged" }, { action: "none" }, { action: "unchanged" }] } });

    // 2027 counts the January purchase, at its own average; the 2026 value isn't carried over.
    expect(await closePreview(owner, 2027, clock)).toMatchObject({ ok: true, value: { entries: [{}, {}, { action: "post", lines: [{ account: "3121", debit: 15_840_000n }, {}] }, { action: "none" }, { action: "none" }] } });
  });

  it("freezes the current values with the count once the run has posted; the owner's only, audited, each organisation its own", async () => {
    expect(await saveYearEndValues(owner, { year: 2026, values: { [ids.feed]: "90 000" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
    expect(await saveYearEndCount(owner, { year: 2026, counts: { [ids.feed]: "19 000" } })).toEqual({ ok: false, error: "COUNT_FROZEN" });
    expect(await yearEndCount(owner, 2026, clock)).toMatchObject({ ok: true, value: { frozen: true } });
    for (const role of ["manager", "accountant", "worker"] as const) {
      expect(await saveYearEndValues({ ...other, role }, { year: 2026, values: { [ids.feed2]: "4 000" } }), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await saveYearEndValues(other, { year: 2026, values: { [ids.feed]: "4 000" } })).toEqual({ ok: false, error: "INVALID_INPUT" }); // not its stock
    expect(await saveYearEndValues(other, { year: 2026, values: { [ids.feed2]: "4 000,123" } })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await saveYearEndValues(owner, { year: 2027, values: { [ids.found]: "10" } })).toEqual({ ok: false, error: "INVALID_INPUT" }); // not valued: no cost to lower
    expect(await saveYearEndValues(other, { year: 2026, values: { [ids.feed2]: "4 000" } })).toEqual({ ok: true, value: 1 });
    expect(await saveYearEndValues(other, { year: 2026, values: { [ids.feed2]: "4 000,00" } })).toEqual({ ok: true, value: 0 }); // the same value
    expect(await saveYearEndValues(other, { year: 2026, values: { [ids.feed2]: "" } })).toEqual({ ok: true, value: 1 }); // back at cost
    const audits = await db.auditEvent.findMany({ where: { entity: "YearEndValue", organizationId: other.organizationId }, orderBy: { id: "asc" }, select: { action: true, before: true, after: true } });
    expect(audits.map((a) => a.action)).toEqual(["create", "delete"]);
    expect(audits[0].after).toEqual({ day: "2026-12-31", subjectId: ids.feed2, valueCentimes: "400000" });
    expect(await db.yearEndValue.count({ where: { organizationId: other.organizationId } })).toBe(0);
    expect(await db.auditEvent.count({ where: { entity: "YearEndValue", organizationId: owner.organizationId } })).toBe(1);
  });

  it("with the PCA off, lands each 31x line on its CGNC account; the counted quantity, without the VAT of a registered entity", async () => {
    expect(await saveYearEndCount(other, { year: 2026, counts: { [ids.vaccine]: "900" } })).toEqual({ ok: true, value: 1 });
    expect(await runClose(other, { year: 2026 }, clock)).toEqual({ ok: true, value: 1 }); // no provision
    expect(await linesOf(`close:stock:${otherEntity}:2026`)).toEqual([
      ["2026-12-31", "3121", 500_000n, 0n], // feed
      ["2026-12-31", "31221", 180_000n, 0n], // 900 of 1 000 doses × 2 000,00 net of VAT; bought on 6122 without the PCA
      ["2026-12-31", "31223", 150_000n, 0n], // gas
      ["2026-12-31", "61241", 0n, 500_000n], // 612412's CGNC fallback, a leaf
      ["2026-12-31", "61242", 0n, 330_000n],
    ]);
    expect(await db.journalEntry.count({ where: { sourceId: `close:provision:${otherEntity}:2026` } })).toBe(0);
    expect(await linesOf(`close:stock:${entity}:2026`)).toHaveLength(2); // each organisation its own stock
  });

  it("reverses the stock entry and the provision on the next year's first day with the year close (FCX5); a second close posts nothing", async () => {
    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 3 }); // the à-nouveaux and both reversals
    expect(await linesOf(`reversal:close:stock:${entity}:2026`)).toEqual([["2027-01-01", "612412", 9_840_000n, 0n], ["2027-01-01", "3121", 0n, 9_840_000n]]);
    expect(await linesOf(`reversal:close:provision:${entity}:2026`)).toEqual([["2027-01-01", "3912", 110_000n, 0n], ["2027-01-01", "7196", 0n, 110_000n]]);
    const reversal = await db.journalEntry.findFirstOrThrow({ where: { sourceId: `reversal:close:provision:${entity}:2026` } });
    expect(reversal).toMatchObject({ journal: "OD", label: "Extourne des écritures de clôture", day: new Date("2027-01-01T00:00:00Z") });
    // The à-nouveaux carries the stock and its provision; the reversals bring both back to zero on 1 January.
    const opened = await db.journalLine.findMany({ where: { entry: { sourceId: `opening:${entity}:2027-01-01` } }, select: { account: true, debitCentimes: true, creditCentimes: true } });
    expect(opened.filter((l) => l.account === "3121" || l.account === "3912").map((l) => [l.account, l.debitCentimes - l.creditCentimes]).sort()).toEqual([["3121", 9_840_000n], ["3912", -110_000n]]);

    expect(await closeFiscalYear(owner, { year: 2026 }, clock)).toEqual({ ok: true, value: 0 });
    expect(await db.journalEntry.count({ where: { legalEntityId: entity, day: new Date("2027-01-01T00:00:00Z") } })).toBe(3);
  });
});
