import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { postEntry, reverseEntry, type EntryRow, type Line } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

const d = (s: string) => s as FarmDay;
const line = (account: string, debit: bigint, credit: bigint): Line => ({ account, debit, credit });
// The real `pnpm db:seed` script, on the test database (vitest sets DATABASE_URL; the script's .env doesn't override it).
const seed = () => execFileSync(process.execPath, ["prisma/seed.ts"], { stdio: "pipe" });
const lines = () => db.journalLine.findMany({ select: { entryId: true, account: true, debitCentimes: true, creditCentimes: true }, orderBy: [{ entryId: "asc" }, { account: "asc" }] });

describe("pnpm db:seed over posted entries (T100)", () => {
  let a: TenantContext, entity: string;
  const ids = [uuidv7(), uuidv7(), uuidv7()];

  beforeAll(async () => {
    seed();
    a = await tenant("+212600000101");
    entity = (await listLegalEntities(a))[0].id;
    const entries: [EntryRow["journal"], Line[]][] = [
      ["AC", [line("612122", 450_000n, 0n), line("4411", 0n, 450_000n)]], // feed on credit
      ["VT", [line("3421", 1_318_560n, 0n), line("712121", 0n, 1_318_560n)]], // birds sold on credit
      ["CA", [line("6136", 80_000n, 0n), line("5161", 0n, 80_000n)]], // vet fees paid in cash
    ];
    for (const [i, [journal, l]] of entries.entries()) {
      const posted = await db.$transaction((tx) => postEntry(tx, a, { id: ids[i], legalEntityId: entity, journal, day: d("2025-03-10"), label: journal, reversesId: null, lines: l }));
      expect(posted, journal).toEqual({ ok: true, value: undefined });
    }
  });

  it("upserts the whole chart twice; posted lines keep their accounts, which stay posting accounts", async () => {
    const before = await lines();
    seed();
    seed();
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    expect(await db.ledgerAccount.count()).toBe(accounts.length);
    expect(await lines()).toEqual(before);
    // A reversal re-checks every line against the reseeded chart (FN4: posting accounts only).
    await db.manualEntry.createMany({ data: ids.map((id) => ({ id, organizationId: a.organizationId, createdBy: a.userId })) }); // FN5: reversible ones
    for (const id of ids) expect(await reverseEntry(a, id), id).toEqual({ ok: true, value: expect.any(String) });
  });
});
