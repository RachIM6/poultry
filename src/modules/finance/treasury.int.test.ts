import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { readFile, storeFile } from "@/modules/documents";
import { attachExpenseReceipt, exportBooks, treasuryOverview } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-03-10T08:00:00+01:00" });
const statuses = async (ctx: TenantContext, ...ms: { id: string; type: string; payload: unknown; createdAt: string }[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));
const linesOf = async (sourceId: string) =>
  (await db.journalLine.findMany({ where: { entry: { sourceId } }, orderBy: [{ entry: { sourceVersion: "asc" } }, { debitCentimes: "desc" }] })).map((l) => [l.account, l.debitCentimes, l.creditCentimes, l.treasuryId]);

describe("treasury and quick expenses (SPEC-finance FN3, FN6, FX2, FX4, T32)", () => {
  let a: TenantContext, b: TenantContext;
  const box = uuidv7();
  const bank = uuidv7();
  const expense = (over: object = {}) =>
    m("finance.recordExpense", { id: uuidv7(), day: "2026-03-10", category: "electricity", amountCentimes: "120000", paidFrom: "cash", treasuryId: box, note: "Facture ONEE", ...over });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [a, b] = await twoTenants();
    expect(
      await statuses(a, m("finance.createTreasuryAccount", { id: box, kind: "cash", name: "Caisse ferme" }), m("finance.createTreasuryAccount", { id: bank, kind: "bank", name: "Banque Populaire" })),
    ).toEqual(["applied", "applied"]);
  });

  it("posts a quick expense recorded offline once, however many times the phone sends it", async () => {
    const e = expense();
    expect(await statuses(a, e)).toEqual(["applied"]);
    expect(await statuses(a, e)).toEqual(["applied"]); // the same mutation again: its stored result
    expect(await statuses(a, { ...e, id: uuidv7() })).toEqual(["errors.ALREADY_EXISTS"]); // the same expense, another mutation
    expect(await linesOf(e.payload.id)).toEqual([["612512", 120_000n, 0n, null], ["5161", 0n, 120_000n, box]]);
    expect(await db.journalEntry.count({ where: { sourceId: e.payload.id } })).toBe(1);
  });

  it("checks where it was paid from, and charges a credit expense to the supplier", async () => {
    expect(await statuses(a, expense({ paidFrom: "bank", treasuryId: box }))).toEqual(["errors.INVALID_INPUT"]); // a cash box isn't a bank
    expect(await statuses(b, expense())).toEqual(["errors.NOT_FOUND"]); // a's cash box
    const credit = expense({ category: "catching", paidFrom: "credit", treasuryId: null, amountCentimes: "80000" });
    expect(await statuses(a, credit)).toEqual(["applied"]);
    expect(await linesOf(credit.payload.id)).toEqual([["612612", 80_000n, 0n, null], ["4411", 0n, 80_000n, null]]);
  });

  it("moves cash to the bank through 5115, and shows each account's balance", async () => {
    const t = m("finance.recordTransfer", { id: uuidv7(), day: "2026-03-11", amountCentimes: "50000", fromId: box, toId: bank });
    expect(await statuses(a, t)).toEqual(["applied"]);
    expect(await linesOf(t.payload.id)).toEqual([["5115", 50_000n, 0n, null], ["5161", 0n, 50_000n, box], ["5141", 50_000n, 0n, bank], ["5115", 0n, 50_000n, null]]);
    const overview = await treasuryOverview(a, "2026-03");
    if (!overview.ok) throw new Error(overview.error);
    expect(overview.value.accounts.map((x) => [x.name, x.balanceCentimes])).toEqual([["Banque Populaire", 50_000n], ["Caisse ferme", -170_000n]]);
    expect(overview.value.movements).toHaveLength(3); // the expense's and both sides of the transfer, on 51xx
  });

  it("attaches an expense's receipt once, shows it on the treasury and puts it in the accountant's zip (FN10, FN18)", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
    const e = expense({ day: "2026-03-12", category: "water", amountCentimes: "30000" });
    expect(await statuses(a, e)).toEqual(["applied"]);
    expect(await storeFile({ ...a, role: "worker" }, "receipt", png)).toEqual({ ok: false, error: "FORBIDDEN" });
    const file = await storeFile(a, "receipt", png);
    if (!file.ok) throw new Error(file.error);
    expect(await attachExpenseReceipt(b, e.payload.id, file.value.id)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await attachExpenseReceipt(a, e.payload.id, file.value.id)).toEqual({ ok: true, value: undefined });
    expect(await attachExpenseReceipt(a, e.payload.id, file.value.id)).toEqual({ ok: false, error: "FILE_ALREADY_ATTACHED" });
    expect(await readFile({ ...a, role: "worker" }, file.value.id)).toEqual({ ok: false, error: "NOT_FOUND" });

    const pulled = (await pull(a, 0, registry)).changes.filter((c) => c.entity === "expense" && c.id === e.payload.id).map((c) => c.data);
    expect(pulled.at(-1)).toEqual({ ...(pulled[0] as object), receiptFileId: file.value.id }); // the phone gets the same expense, with its receipt

    const overview = await treasuryOverview(a, "2026-03");
    if (!overview.ok) throw new Error(overview.error);
    expect(overview.value.movements.map((x) => x.receipt)).toEqual([null, undefined, undefined, file.value.id]); // first expense, transfer, this one

    const entry = await db.journalEntry.findFirstOrThrow({ where: { sourceId: e.payload.id } });
    const zipped = await exportBooks(a, "2026-03");
    if (!zipped.ok) throw new Error(zipped.error);
    expect(zipped.value.zip.includes(`pieces/2026-03-12_${entry.id}.png`)).toBe(true);
    const april = await exportBooks(a, "2026-04");
    if (!april.ok) throw new Error(april.error);
    expect(april.value.zip.includes("pieces/")).toBe(false); // only the month's entries bring their receipts
  });

  it("keeps workers out of every finance mutation and record", async () => {
    const worker = { ...a, role: "worker" as const };
    expect(await statuses(worker, expense())).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(worker, m("finance.createTreasuryAccount", { id: uuidv7(), kind: "cash", name: "x" }))).toEqual(["errors.FORBIDDEN"]);
    const pulled = (await pull(worker, 0, registry)).changes.map((c) => c.entity);
    expect(pulled.filter((e) => ["expense", "transfer", "treasuryAccount"].includes(e))).toEqual([]);
    expect(await treasuryOverview(worker, "2026-03")).toEqual({ ok: false, error: "FORBIDDEN" });
    expect((await pull(a, 0, registry)).changes.some((c) => c.entity === "expense")).toBe(true);
  });
});
