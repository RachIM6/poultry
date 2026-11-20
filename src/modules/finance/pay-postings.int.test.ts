import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { batchResults, postPending } from "@/modules/finance";
import { AccountsFile } from "@/modules/finance/schema";
import { wagesDue } from "@/modules/workforce";
import { attendanceId, payMonthId, payPaymentId, WORKFORCE_MUTATIONS as M } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const linesOf = async (where: object) =>
  (await db.journalLine.findMany({ where: { entry: where }, orderBy: [{ entry: { createdAt: "asc" } }, { account: "asc" }] })).map((l) => [l.account, l.debitCentimes, l.creditCentimes]);

// SPEC-m4 WF10, WF12 posted by finance (plan-m4 "Later"; accounts to confirm with the accountant).
describe("pay postings", () => {
  let a: TenantContext;
  const [farm, said, omar, advance] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const [house, batch, otherFarm, otherHouse, otherBatch] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const day = (d: string, status = "present") => m(M.setAttendance, { id: attendanceId(said, d), employeeId: said, day: d, status, arrivedAt: null });

  beforeAll(async () => {
    const { accounts } = AccountsFile.parse(JSON.parse(readFileSync("prisma/seed/finance/accounts.json", "utf8")));
    await db.ledgerAccount.createMany({ data: accounts.map((x) => ({ chart: x.chart, number: x.number, label: x.label, parentNumber: x.parent, fallback: x.fallback })) });
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    [a] = await twoTenants();
    const pushed = await push(
      a,
      [
        m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        // a batch on this farm through September, and one on another farm that pays no one
        m("farm-registry.createHouse", { id: house, farmId: farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("flock.placeBatch", { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-08-25", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
        m("farm-registry.createFarm", { id: otherFarm, name: "G", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
        m("farm-registry.createHouse", { id: otherHouse, farmId: otherFarm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" }),
        m("flock.placeBatch", { id: otherBatch, houseId: otherHouse, strainId: "ross-308", placedOn: "2026-08-25", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null }),
        // 150,00 DH a day; 2 days present + 1 on leave = 3 paid days (⚠️ MQ2) = 450,00 DH gross
        m(M.createEmployee, { id: said, farmId: farm, name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "15000", cnssNumber: null, houseIds: [] }),
        day("2026-09-01"), day("2026-09-02"), day("2026-09-03", "leave"),
        m(M.recordAdvance, { id: advance, employeeId: said, day: "2026-09-02", amountCentimes: "5000", deductMonth: "2026-09", note: null }),
        // Omar: 1 day (150,00) but 300,00 advanced: net −150,00, so 150,00 of his advance stays owed
        m(M.createEmployee, { id: omar, farmId: farm, name: "Omar B.", job: "worker", phone: null, housedOnFarm: true, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "15000", cnssNumber: null, houseIds: [] }),
        m(M.setAttendance, { id: attendanceId(omar, "2026-09-01"), employeeId: omar, day: "2026-09-01", status: "present", arrivedAt: null }),
        m(M.recordAdvance, { id: uuidv7(), employeeId: omar, day: "2026-09-01", amountCentimes: "30000", deductMonth: "2026-09", note: null }),
        m(M.payWages, { farmId: farm, month: "2026-09", day: "2026-09-30", paidFrom: "bank" }), // refused: not validated yet
        m(M.validatePay, { farmId: farm, month: "2026-09" }),
      ],
      registry,
    );
    expect(pushed.results.filter((r) => r.status !== "applied").map((r) => r.status === "rejected" && r.messageKey)).toEqual(["errors.PAY_MONTH_NOT_VALIDATED"]);
    await postPending(a);
  });

  it("pays the advance from the cash box", async () => {
    expect(await linesOf({ sourceId: advance })).toEqual([["3431", 5_000n, 0n], ["5161", 0n, 5_000n]]);
  });

  it("books the validated month on its last day: gross, the advances it covers taken back, the net owed (no CNSS rates yet)", async () => {
    const id = payMonthId(farm, "2026-09");
    const entry = await db.journalEntry.findFirstOrThrow({ where: { sourceId: id } });
    expect([entry.journal, entry.day.toISOString().slice(0, 10)]).toEqual(["OD", "2026-09-30"]);
    // gross 450,00 + 150,00; advances taken back 50,00 + 150,00 (Omar's other 150,00 stays on 3431); owed 400,00
    expect(await linesOf({ sourceId: id })).toEqual([["3431", 0n, 20_000n], ["4432", 0n, 40_000n], ["6171", 60_000n, 0n]]);
  });

  it("shares the month's labour cost over that farm's batches only (FN14)", async () => {
    const results = await batchResults(a);
    if (!results.ok) throw new Error(results.error);
    const allocated = (id: string) => results.value.find((r) => r.id === id)?.costs.allocated;
    expect([allocated(batch), allocated(otherBatch)]).toEqual([60_000n, 0n]); // gross 600,00, no CNSS rate entered
  });

  it("pays the month's net once, from the bank, and it leaves the unpaid wages", async () => {
    expect(await wagesDue(a)).toEqual([{ dueOn: "2026-09-30", amountCentimes: 40_000n }]);
    const pay = m(M.payWages, { farmId: farm, month: "2026-09", day: "2026-10-02", paidFrom: "bank" });
    expect((await push(a, [pay], registry)).results[0].status).toBe("applied");
    expect((await push(a, [{ ...pay, id: uuidv7() }], registry)).results[0]).toMatchObject({ messageKey: "errors.ALREADY_DONE" });
    expect((await push({ ...a, role: "manager" }, [{ ...pay, id: uuidv7() }], registry)).results[0]).toMatchObject({ messageKey: "errors.FORBIDDEN" });
    await postPending(a);
    expect(await linesOf({ sourceId: payPaymentId(farm, "2026-09") })).toEqual([["4432", 40_000n, 0n], ["5141", 0n, 40_000n]]);
    expect(await wagesDue(a)).toEqual([]);
  });
});
