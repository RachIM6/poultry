import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import type { TenantContext } from "@/lib/tenant";
import { createOrganization, listLegalEntities } from "@/modules/farm-registry";
import { associateAccount, recordAssociateMovement, setPeriodLocked } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { tenant } from "@/test/tenant";

// SPEC-finance FN6, FQ11, §9 "Associate contributions": an associate's (4463) or the exploitant's (1117) money in or out.
const clock = fixedClock("2026-06-15T10:00:00Z");
const OK = { ok: true, value: undefined };
const linesOf = async (id: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceModule: "finance", sourceId: `associate:${id}` } }, include: { entry: true }, orderBy: { debitCentimes: "desc" } })).map((l) => [
    l.entry.journal,
    l.entry.day.toISOString().slice(0, 10),
    l.entry.label,
    l.account,
    l.debitCentimes,
    l.creditCentimes,
    l.treasuryId,
  ]);

async function company(phone: string): Promise<TenantContext> {
  const user = await db.user.create({ data: { phoneNumber: phone, name: phone, email: `${phone.slice(1)}@phone.invalid` } });
  const ctx = await createOrganization(user.id, { name: "SARL Atlas", form: "company", locale: "fr" });
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx.value;
}

describe("associate contributions and withdrawals (SPEC-finance FN6, FQ11)", () => {
  let sarl: TenantContext, exploitant: TenantContext;
  const [bank, box, ownBox] = [uuidv7(), uuidv7(), uuidv7()];
  const movement = (more: object = {}) => ({ id: uuidv7(), day: "2026-04-10", direction: "contribution", amountCentimes: "5000000", treasuryId: bank, associate: "Karim", ...more });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((a) => ({ chart: a.chart, number: a.number, label: a.label, parentNumber: a.parent, fallback: a.fallback })) });
    sarl = await company("+212600000001");
    exploitant = await tenant("+212600000002", "Ferme B"); // an individual, cash_book by default
    await db.treasuryAccount.createMany({
      data: [
        { id: bank, organizationId: sarl.organizationId, kind: "bank", name: "Banque Populaire" },
        { id: box, organizationId: sarl.organizationId, kind: "cash", name: "Caisse" },
        { id: ownBox, organizationId: exploitant.organizationId, kind: "cash", name: "Caisse" },
      ],
    });
  });

  it("says which account: 4463 for a company's associates, 1117 Capital personnel for an individual", async () => {
    expect(await associateAccount(sarl)).toEqual({ ok: true, value: { account: "4463", individual: false } });
    expect(await associateAccount(exploitant)).toEqual({ ok: true, value: { account: "1117", individual: true } });
  });

  it("posts an associate's contribution at the bank, D 5141 / C 4463, once per form", async () => {
    const m = movement();
    expect(await recordAssociateMovement(sarl, m, clock)).toEqual(OK);
    expect(await recordAssociateMovement(sarl, m, clock)).toEqual(OK); // the same form again
    expect(await linesOf(m.id)).toEqual([
      ["BQ", "2026-04-10", "Apport de l'associé : Karim", "5141", 5_000_000n, 0n, bank],
      ["BQ", "2026-04-10", "Apport de l'associé : Karim", "4463", 0n, 5_000_000n, null],
    ]);
    const audited = await db.auditEvent.findFirstOrThrow({ where: { organizationId: sarl.organizationId, entity: "AssociateAccount", entityId: m.id } });
    expect([audited.action, audited.after]).toEqual(["contribution", expect.objectContaining({ amountCentimes: "5000000", treasuryId: bank, associate: "Karim", account: "4463" })]);
  });

  it("posts a withdrawal from the cash box, D 4463 / C 5161, with no name", async () => {
    const m = movement({ direction: "withdrawal", amountCentimes: "100000", treasuryId: box, associate: " " });
    expect(await recordAssociateMovement(sarl, m, clock)).toEqual(OK);
    expect(await linesOf(m.id)).toEqual([
      ["CA", "2026-04-10", "Retrait de l'associé", "4463", 100_000n, 0n, null],
      ["CA", "2026-04-10", "Retrait de l'associé", "5161", 0n, 100_000n, box],
    ]);
  });

  it("posts the individual exploitant's on 1117, cash_book books too", async () => {
    const [put, take] = [movement({ treasuryId: ownBox, associate: null, amountCentimes: "300000" }), movement({ treasuryId: ownBox, associate: null, direction: "withdrawal", amountCentimes: "50000" })];
    expect(await recordAssociateMovement(exploitant, put, clock)).toEqual(OK);
    expect(await recordAssociateMovement(exploitant, take, clock)).toEqual(OK);
    expect(await linesOf(put.id)).toEqual([
      ["CA", "2026-04-10", "Apport de l'exploitant", "5161", 300_000n, 0n, ownBox],
      ["CA", "2026-04-10", "Apport de l'exploitant", "1117", 0n, 300_000n, null],
    ]);
    expect((await linesOf(take.id)).map((l) => [l[3], l[4], l[5]])).toEqual([
      ["1117", 50_000n, 0n],
      ["5161", 0n, 50_000n],
    ]);
  });

  it("refuses, writing nothing: another's account, a future day, a locked month, bad input", async () => {
    const entries = () => db.journalEntry.count({ where: { organizationId: sarl.organizationId } });
    const before = await entries();
    expect(await recordAssociateMovement(sarl, movement({ treasuryId: ownBox }), clock)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await recordAssociateMovement(sarl, movement({ day: "2026-06-17" }), clock)).toEqual({ ok: false, error: "DAY_IN_FUTURE" });
    for (const bad of [{ amountCentimes: "0" }, { treasuryId: null }, { direction: "gift" }, { associate: "x".repeat(81) }]) {
      expect(await recordAssociateMovement(sarl, movement(bad), clock), JSON.stringify(bad)).toEqual({ ok: false, error: "INVALID_INPUT" });
    }
    const entity = (await listLegalEntities(sarl))[0].id;
    expect(await setPeriodLocked(sarl, entity, "2026-05", true)).toEqual(OK);
    expect(await recordAssociateMovement(sarl, movement({ day: "2026-05-20" }), clock)).toEqual({ ok: false, error: "PERIOD_LOCKED" });
    expect(await setPeriodLocked(sarl, entity, "2026-05", false)).toEqual(OK);
    expect(await entries()).toBe(before);
  });

  it("is the owner's only", async () => {
    for (const role of ["manager", "accountant", "worker", "vet"] as const) {
      const ctx = { ...sarl, role };
      expect(await recordAssociateMovement(ctx, movement(), clock), role).toEqual({ ok: false, error: "FORBIDDEN" });
      expect(await associateAccount(ctx), role).toEqual({ ok: false, error: "FORBIDDEN" });
    }
  });
});
