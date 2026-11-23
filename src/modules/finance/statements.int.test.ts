import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, officialStatements, openFiscalYear, postEntry, type EntryRow, type Line } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const line = (account: string, debit: bigint, credit: bigint): Line => ({ account, debit, credit });

describe("official statements (SPEC-finance FC8, T116)", () => {
  let ledger: TenantContext, cashBook: TenantContext, entity: string;

  const post = async (day: string, journal: EntryRow["journal"], lines: Line[]) => {
    const posted = await db.$transaction((tx) => postEntry(tx, ledger, { id: uuidv7(), legalEntityId: entity, journal, day: day as FarmDay, label: journal, reversesId: null, lines }));
    expect(posted).toEqual({ ok: true, value: undefined });
  };

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [ledger, cashBook] = await twoTenants();
    entity = (await listLegalEntities(ledger))[0].id;
    expect(await changeAccountingChoices(ledger, entity, { books: "ledger", pcaOverlay: true, fiscalYearStartMonth: 1 })).toMatchObject({ ok: true });
    // 2025: capital in the bank, a building, birds sold, feed, its depreciation.
    await post("2025-01-02", "OD", [line("5141", 20_000_000n, 0n), line("1117", 0n, 20_000_000n)]);
    await post("2025-02-01", "BQ", [line("2328", 12_000_000n, 0n), line("5141", 0n, 12_000_000n)]);
    await post("2025-06-10", "VT", [line("3421", 9_000_000n, 0n), line("712121", 0n, 9_000_000n)]);
    await post("2025-06-12", "AC", [line("612122", 5_000_000n, 0n), line("4411", 0n, 5_000_000n)]);
    await post("2025-12-31", "OD", [line("61932", 600_000n, 0n), line("28321", 0n, 600_000n)]);
    // 2026: the à-nouveaux, then hens bought and the client paying.
    expect(await openFiscalYear(ledger, { year: 2026 })).toMatchObject({ ok: true });
    await post("2026-03-01", "BQ", [line("23711", 4_000_000n, 0n), line("5141", 0n, 4_000_000n)]);
    await post("2026-04-01", "BQ", [line("5141", 9_000_000n, 0n), line("3421", 0n, 9_000_000n)]);
    await post("2026-12-31", "OD", [line("61932", 600_000n, 0n), line("61937", 400_000n, 0n), line("28321", 0n, 600_000n), line("28371", 0n, 400_000n)]);
    await db.fiscalYearClose.create({ data: { organizationId: ledger.organizationId, legalEntityId: entity, day: new Date("2025-12-31T00:00:00Z"), closedBy: ledger.userId, closedAt: new Date("2026-02-15T10:00:00Z") } });
  });

  const poste = (s: Extract<Awaited<ReturnType<typeof officialStatements>>, { ok: true }>["value"], key: string) =>
    s.books === "ledger" ? [...s.bilan.actif, ...s.bilan.passif].flatMap((m) => m.rubriques.flatMap((r) => r.postes)).find((x) => x.key === key) : undefined;

  it("gives the closed year's bilan, CPC and their checks", async () => {
    const r = await officialStatements(ledger, 2025);
    if (!r.ok || r.value.books !== "ledger") throw new Error("no statements");
    const s = r.value;
    expect(s).toMatchObject({ pca: true, closedOn: "2026-02-15", previous: null, aboveLimit: false });
    expect(s.bilan.totalActif).toBe(s.bilan.totalPassif);
    expect(s.bilan.result).toBe(9_000_000n - 5_000_000n - 600_000n);
    expect(poste(s, "constructions")).toMatchObject({ gross: 12_000_000n, contra: 600_000n, net: 11_400_000n });
    expect(poste(s, "banques")?.net).toBe(8_000_000n);
    expect(poste(s, "clients")?.net).toBe(9_000_000n);
    expect(poste(s, "capital")?.net).toBe(20_000_000n);
    expect(poste(s, "fournisseurs")?.net).toBe(5_000_000n);
    expect(s.cpc.results.find((x) => x.key === "chiffreAffaires")?.amount).toBe(9_000_000n);
  });

  it("gives the open year as a draft, with N-1 and the ETIC from the à-nouveaux", async () => {
    const r = await officialStatements(ledger, 2026);
    if (!r.ok || r.value.books !== "ledger") throw new Error("no statements");
    const s = r.value;
    expect(s.closedOn).toBeNull();
    expect(s.previous?.bilan.result).toBe(3_400_000n);
    expect(s.bilan.totalActif).toBe(s.bilan.totalPassif);
    expect(s.bilan.result).toBe(-1_000_000n);
    expect(poste(s, "reportANouveau")?.net).toBe(3_400_000n); // last year's result, not allocated yet (on 1191)
    expect(poste(s, "animaux")).toMatchObject({ gross: 4_000_000n, contra: 400_000n });
    expect(s.etic.s1.find((x) => x.key === "constructions")).toMatchObject({ start: 12_000_000n, increase: 0n, decrease: 0n, end: 12_000_000n });
    expect(s.etic.s1bis.find((x) => x.key === "constructions")).toMatchObject({ start: 600_000n, increase: 600_000n, end: 1_200_000n });
    expect(s.etic.s1_1?.find((x) => x.key === "animauxImmobilisations")).toMatchObject({ start: 0n, increase: 4_000_000n, end: 4_000_000n });
  });

  it("gives a cash-book entity no statements; workers can't read them", async () => {
    expect(await officialStatements(cashBook, 2025)).toEqual({ ok: true, value: { books: "cash_book", year: 2025 } });
    expect(await officialStatements({ ...ledger, role: "worker" }, 2025)).toEqual({ ok: false, error: "FORBIDDEN" });
  });
});
