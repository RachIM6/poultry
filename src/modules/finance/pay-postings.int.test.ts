import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { attendanceId, payMonthId, WORKFORCE_MUTATIONS as M } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const linesOf = async (where: object) =>
  (await db.journalLine.findMany({ where: { entry: where }, orderBy: [{ entry: { createdAt: "asc" } }, { account: "asc" }] })).map((l) => [l.account, l.debitCentimes, l.creditCentimes]);

// SPEC-m4 WF10, WF12 posted by finance (plan-m4 "Later"; accounts to confirm with the accountant).
describe("pay postings", () => {
  let a: TenantContext;
  const [farm, said, advance] = [uuidv7(), uuidv7(), uuidv7()];
  const day = (d: string, status = "present") => m(M.setAttendance, { id: attendanceId(said, d), employeeId: said, day: d, status, arrivedAt: null });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    [a] = await twoTenants();
    const pushed = await push(
      a,
      [
        m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        // 150,00 DH a day; 2 days present + 1 on leave = 3 paid days (⚠️ MQ2) = 450,00 DH gross
        m(M.createEmployee, { id: said, farmId: farm, name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "15000", cnssNumber: null, houseIds: [] }),
        day("2026-09-01"), day("2026-09-02"), day("2026-09-03", "leave"),
        m(M.recordAdvance, { id: advance, employeeId: said, day: "2026-09-02", amountCentimes: "5000", deductMonth: "2026-09", note: null }),
        m(M.validatePay, { farmId: farm, month: "2026-09" }),
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied")).toEqual([]);
    await postPending(a);
  });

  it("pays the advance from the cash box", async () => {
    expect(await linesOf({ sourceId: advance })).toEqual([["3431", 5_000n, 0n], ["5161", 0n, 5_000n]]);
  });

  it("books the validated month on its last day: gross, the advance taken back, the net owed (no CNSS rates yet)", async () => {
    const id = payMonthId(farm, "2026-09");
    const entry = await db.journalEntry.findFirstOrThrow({ where: { sourceId: id } });
    expect([entry.journal, entry.day.toISOString().slice(0, 10)]).toEqual(["OD", "2026-09-30"]);
    expect(await linesOf({ sourceId: id })).toEqual([["3431", 0n, 5_000n], ["4432", 0n, 40_000n], ["6171", 45_000n, 0n]]);
  });
});
