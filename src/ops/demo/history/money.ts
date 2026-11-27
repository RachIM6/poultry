import { db } from "@/lib/db";
import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { bankReconciliation, importBankFile, matchBankLine } from "@/modules/finance";
import { purchaseAmount } from "@/modules/inventory/shared";
import { attendanceId } from "@/modules/workforce/schema";
import { at, id, must } from "../kit";
import { plate, type Needs, type SaleDone } from "./flocks";
import { RANK, type Flow, type Rng, type Story } from "./story";

// The long history's purchases, payments, wages and cash: what the feed and vaccines eaten called for, settled as a
// farm settles them, and a treasurer who keeps the cash box and the bank account plausible.

type Unit = "kg" | "ml" | "dose" | "unit";
export type Supplier = { id: string; credit: boolean }; // credit: invoices paid by monthly statement, else on delivery in cash

/**
 * Buys `item` before it runs out: when the stock no longer covers the next `cover` days, an order for the next `ahead`
 * days, rounded up to `step`. `vat` is the share of VAT in the price (VAT-registered company), 0 otherwise.
 */
export function supply(
  story: Story,
  rng: Rng,
  needs: Needs,
  o: { item: string; unit: Unit; supplier: Supplier; farmId: string; price: (day: FarmDay) => number; step: number; cover: number; ahead: number; vatRate?: number; delivery?: boolean; lastOrder?: FarmDay },
) {
  const days = needs.get(o.item);
  if (!days) return null;
  const sorted = [...days.keys()].sort();
  const want = (from: FarmDay, n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += days.get(addFarmDays(from, i)) ?? 0;
    return s;
  };
  let stock = 0;
  for (let day = addFarmDays(sorted[0], -1); day <= sorted[sorted.length - 1]; day = addFarmDays(day, 1)) {
    stock -= days.get(day) ?? 0; // what today eats; the delivery below is for tomorrow on
    if (stock < want(addFarmDays(day, 1), o.cover) && (!o.lastOrder || day <= o.lastOrder || stock < want(addFarmDays(day, 1), 1))) {
      const quantity = Math.max(o.step, Math.ceil((want(addFarmDays(day, 1), o.ahead) - stock) / o.step) * o.step);
      buy(story, rng, { ...o, day, quantity, unitPriceCentimes: o.price(day) });
      stock += quantity;
    }
  }
  return { left: stock, lastDay: sorted[sorted.length - 1] };
}

/** One purchase, its total as the app computes it; on credit to a statement supplier, else paid in cash on delivery. */
export function buy(story: Story, rng: Rng, o: { item: string; unit: Unit; supplier: Supplier; farmId: string; day: FarmDay; quantity: number; unitPriceCentimes: number; vatRate?: number; delivery?: boolean }) {
  const total = Number(purchaseAmount(o.quantity, o.unit, BigInt(o.unitPriceCentimes)));
  const vatCentimes = String(o.vatRate ? Math.round((total * o.vatRate) / (100 + o.vatRate)) : 0);
  const credit = o.supplier.credit;
  story.add(o.day, RANK.buy, "manager", "inventory.recordPurchase", {
    id: id(), movementId: id(), supplierId: o.supplier.id, stockItemId: o.item, day: o.day, quantity: o.quantity, unitPriceCentimes: String(o.unitPriceCentimes),
    paidCentimes: credit ? "0" : String(total), paidMethod: credit ? "transfer" : "cash", dueOn: credit ? addFarmDays(o.day, 30) : null, vatCentimes,
  }, credit ? undefined : { cash: -total });
  if (o.delivery !== false)
    story.add(o.day, RANK.buy, "worker", "biosecurity.recordVisit", { id: id(), farmId: o.farmId, enteredAt: at(o.day, "08:30"), visitor: "Chauffeur du fournisseur", vehicle: plate(rng), purpose: "feedDelivery", recentFarm: true, wheelsDisinfected: true, footbath: true, farmClothing: false, zone: "dirty" });
  return total;
}

/**
 * Credit suppliers paid by monthly statement on the 10th: the previous month's deliveries, by transfer, cheque or an
 * accepted bill (due 30 days later). Reads the purchases already in the story.
 */
export function payStatements(story: Story, rng: Rng, suppliers: Supplier[], units: Record<string, Unit>, instrument: (kind: "cheque" | "bill") => string) {
  const owed = new Map<string, number>(); // supplier:month → centimes
  for (const s of story.steps) {
    if (!("type" in s) || s.type !== "inventory.recordPurchase") continue;
    const p = s.payload as { supplierId: string; stockItemId: string; quantity: number; unitPriceCentimes: string; paidCentimes: string };
    if (p.paidCentimes !== "0") continue;
    const key = `${p.supplierId}:${s.day.slice(0, 7)}`;
    owed.set(key, (owed.get(key) ?? 0) + Number(purchaseAmount(p.quantity, units[p.stockItemId], BigInt(p.unitPriceCentimes))));
  }
  for (const [key, amount] of [...owed].sort(([a], [b]) => a.localeCompare(b))) {
    const [supplierId, month] = key.split(":");
    if (!suppliers.some((x) => x.id === supplierId)) continue;
    const day = addFarmDays(`${month}-01` as FarmDay, 31 + 9).slice(0, 7) + "-10";
    const method = rng.pick(["transfer", "transfer", "cheque", "bill"] as const);
    const paper = method === "cheque" || method === "bill" ? { number: instrument(method), dueOn: addFarmDays(day as FarmDay, method === "bill" ? 30 : 0) } : null;
    const paymentId = id();
    story.add(day as FarmDay, RANK.money, "manager", "inventory.recordSupplierPayment", { id: paymentId, supplierId, day, amountCentimes: String(amount), method, instrument: paper }, method === "bill" ? undefined : { bank: -amount });
    // FN11: the cheque or the accepted bill debited by the bank on its due day (the bill's money leaves then).
    if (paper && story.add(addFarmDays(paper.dueOn, 1), RANK.money, "manager", "inventory.debitIssued", { id: id(), instrumentId: paymentId, day: addFarmDays(paper.dueOn, 1) }) && method === "bill")
      story.flow(addFarmDays(paper.dueOn, 1), { bank: -amount });
  }
}

/**
 * Keeps the cash box and the bank plausible, day by day, from the flows of the story: cash drawn from the bank the day
 * before it is needed, the cash sales deposited, the owner's contribution when the bank runs low, and (`drawings`) the
 * owner's monthly drawings once it holds more than the farm needs. Run last: it reads every other step.
 */
export function treasurer(story: Story, o: { cash: string; bank: string; openingBank: number; floorCash: number; floorBank: number; drawings: number; contribute: (day: FarmDay, amount: number) => void; withdraw: (day: FarmDay, amount: number) => void }) {
  const byDay = new Map<FarmDay, Flow[]>();
  for (const s of [...story.steps, ...story.flows]) if (s.flow) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s.flow]);
  let cash = 0;
  let bank = o.openingBank;
  const sum = (day: FarmDay, k: keyof Flow) => (byDay.get(day) ?? []).reduce((s, f) => s + (f[k] ?? 0), 0);
  const out = (day: FarmDay, k: keyof Flow) => (byDay.get(day) ?? []).reduce((s, f) => s + Math.min(0, f[k] ?? 0), 0);
  const days = story.days();
  for (const day of days) {
    cash += sum(day, "cash");
    bank += sum(day, "bank");
    const tomorrow = addFarmDays(day, 1);
    const needCash = -out(tomorrow, "cash") + o.floorCash;
    if (cash < needCash) {
      const amount = Math.ceil((needCash - cash + o.floorCash) / 1_000_000) * 1_000_000; // round 10 000 DH
      story.add(day, RANK.late, "manager", "finance.recordTransfer", { id: id(), day, amountCentimes: String(amount), fromId: o.bank, toId: o.cash });
      cash += amount;
      bank -= amount;
    } else if (cash > 6 * o.floorCash && daysBetween(story.from, day) % 7 === 4) {
      const amount = Math.floor((cash - 2 * o.floorCash) / 100_000) * 100_000; // the week's cash sales, to the bank
      story.add(day, RANK.late, "manager", "finance.recordTransfer", { id: id(), day, amountCentimes: String(amount), fromId: o.cash, toId: o.bank });
      cash -= amount;
      bank += amount;
    }
    const needBank = -out(tomorrow, "bank") + o.floorBank;
    if (bank < needBank) {
      const amount = Math.ceil((needBank - bank + o.floorBank) / 5_000_000) * 5_000_000; // round 50 000 DH
      o.contribute(day, amount);
      bank += amount;
    } else if (o.drawings > 0 && day.endsWith("-28") && bank > 8 * o.floorBank) {
      o.withdraw(day, o.drawings);
      bank -= o.drawings;
    }
  }
  return { cash, bank };
}

export type Employee = { id: string; farmId: string; name: string; job: "lead" | "worker" | "guard" | "other"; phone: string | null; housed: boolean; startedOn: FarmDay; wage: number; rest: number; houseIds: string[]; cnss: string | null };

/**
 * The team's days from each start (rest on their weekday, a yearly leave, a few absences), each month validated by the
 * owner on the 1st and paid on the 3rd (cash or bank), advances deducted, and the trainings. Returns nothing: the flows
 * of the pay go into the story.
 */
export function team(story: Story, rng: Rng, staff: Employee[], o: { payFrom: (farmId: string) => "cash" | "bank"; advances: [day: string, employeeId: string, dh: number][] }) {
  const paid = new Map<string, number>(); // farm:month → centimes
  for (const e of staff) {
    story.add(story.from, RANK.setup + 5, "manager", "workforce.createEmployee", { id: e.id, farmId: e.farmId, name: e.name, job: e.job, phone: e.phone, housedOnFarm: e.housed, startedOn: e.startedOn, leftOn: null, dailyWageCentimes: String(e.wage), cnssNumber: e.cnss, houseIds: e.houseIds });
    const leaveStart = new Set([`2025-08-${String(rng.int(4, 18)).padStart(2, "0")}`, `2026-07-${String(rng.int(6, 20)).padStart(2, "0")}`]);
    let leaveLeft = 0;
    for (const day of story.days()) {
      if (day < e.startedOn || day >= story.today) continue; // today's attendance is the morning's to take
      if (leaveStart.has(day)) leaveLeft = 12;
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      const status = weekday === e.rest ? "rest" : leaveLeft-- > 0 ? "leave" : rng.chance(0.012) ? "absent" : "present";
      const arrivedAt = status === "present" ? (rng.chance(0.08) ? `07:${rng.int(15, 45)}` : "07:00") : null;
      story.add(day, RANK.staff, "manager", "workforce.setAttendance", { id: attendanceId(e.id, day), employeeId: e.id, day, status, arrivedAt });
      if (status === "present" || status === "leave") paid.set(`${e.farmId}:${day.slice(0, 7)}`, (paid.get(`${e.farmId}:${day.slice(0, 7)}`) ?? 0) + e.wage);
    }
  }
  for (const [day, employeeId, dh] of o.advances) {
    const e = staff.find((x) => x.id === employeeId)!;
    const amount = dh * 100;
    if (story.add(day as FarmDay, RANK.staff, "manager", "workforce.recordAdvance", { id: id(), employeeId, day, amountCentimes: String(amount), deductMonth: day.slice(0, 7), note: "Avance sur salaire" }, { cash: -amount }))
      paid.set(`${e.farmId}:${day.slice(0, 7)}`, (paid.get(`${e.farmId}:${day.slice(0, 7)}`) ?? 0) - amount);
  }
  for (const [key, amount] of paid) {
    const [farmId, month] = key.split(":");
    const next = addFarmDays(`${month}-01` as FarmDay, 32).slice(0, 7);
    const from = o.payFrom(farmId);
    if (story.add(`${next}-01` as FarmDay, RANK.staff, "owner", "workforce.validatePay", { farmId, month }))
      story.add(`${next}-03` as FarmDay, RANK.staff, "owner", "workforce.payWages", { farmId, month, day: `${next}-03`, paidFrom: from }, from === "cash" ? { cash: -amount } : { bank: -amount });
  }
}

const ascii = (s: string) => s.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/[;"]/g, " ").toUpperCase().slice(0, 60);
const dmy = (d: FarmDay) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const amountOf = (c: bigint) => (c === 0n ? "" : `${c / 100n},${String(c % 100n).padStart(2, "0")}`);

/**
 * FC9: the bank's statement of one month, as the bank's CSV export: the account's book lines of that month (the fees
 * included, booked by the farm on the last day), imported, then every line ticked: the month is reconciled.
 */
export async function monthStatement(ctx: TenantContext, treasuryId: string, month: string, clock: { now: () => Date }) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const endDay = addFarmDays(`${month}-01` as FarmDay, 31).slice(0, 7) + "-01";
  const last = addFarmDays(endDay as FarmDay, -1);
  const lines = await db.journalLine.findMany({
    where: { organizationId: ctx.organizationId, account: "5141", treasuryId, entry: { day: { lte: new Date(`${last}T00:00:00Z`) } } },
    select: { debitCentimes: true, creditCentimes: true, entry: { select: { day: true, label: true } } },
    orderBy: [{ entry: { day: "asc" } }, { id: "asc" }],
  });
  const ofMonth = lines.filter((l) => l.entry.day >= first);
  const closing = lines.reduce((s, l) => s + l.debitCentimes - l.creditCentimes, 0n);
  const rows = ofMonth.map((l) => `${dmy(l.entry.day.toISOString().slice(0, 10) as FarmDay)};${ascii(l.entry.label)};${amountOf(l.creditCentimes)};${amountOf(l.debitCentimes)}`);
  const csv = ["Date;Libelle;Debit;Credit", ...rows].join("\n");
  const mapping = { separator: ";", skipLines: 1, dateColumn: 1, dateFormat: "DD/MM/YYYY", labelColumn: 2, amountColumn: null, debitColumn: 3, creditColumn: 4, decimalComma: true };
  const imported = await importBankFile(ctx, { treasuryId, format: "csv", fileName: `releve-${month}.csv`, bytes: new TextEncoder().encode(csv), csv: { mapping, endDay: last, closingCentimes: String(closing) }, dryRun: false }, clock);
  if (!imported.ok) return imported;
  const read = must("bank reconciliation", await bankReconciliation(ctx, treasuryId)).value;
  const statementId = read.statement!.id;
  for (const lineId of (read.statement?.imported ?? []).flatMap((i) => (i.lineId ? [i.lineId] : []))) must("bank tick", await matchBankLine(ctx, { statementId, lineId, ticked: true }));
  return { ok: true as const, rows: rows.length };
}

export type Credit = { buyerId: string; day: FarmDay; amount: number; method: "cash" | "transfer" };

/**
 * The sales' money: a cheque or a bill remitted the day after its date (a post-dated one waits in the portfolio) and
 * cashed two days later; credit collected one to three weeks later; and once (`bounce`), a cheque back unpaid, the
 * buyer paying in cash days later and the owner lifting his block. `credits`: other amounts owed, collected on their day.
 */
export function receivables(story: Story, rng: Rng, sales: SaleDone[], credits: Credit[], o: { bounce?: (sale: SaleDone) => boolean } = {}) {
  let bounced = false;
  for (const s of sales) {
    if (s.instrument) {
      const remitOn = addFarmDays(s.instrument.dueOn > s.day ? s.instrument.dueOn : s.day, 1);
      if (!story.add(remitOn, RANK.money, "manager", "sales.setInstrumentState", { id: id(), instrumentId: s.instrument.id, state: "remitted", day: remitOn })) continue;
      if (!bounced && s.method === "cheque" && o.bounce?.(s)) {
        bounced = true;
        story.add(addFarmDays(remitOn, 4), RANK.money, "manager", "sales.setInstrumentState", { id: id(), instrumentId: s.instrument.id, state: "unpaid", day: addFarmDays(remitOn, 4) });
        story.add(addFarmDays(remitOn, 9), RANK.money, "manager", "sales.recordPayment", { id: id(), buyerId: s.buyerId, day: addFarmDays(remitOn, 9), amountCentimes: String(s.total), method: "cash", instrument: null }, { cash: s.total });
        story.add(addFarmDays(remitOn, 10), RANK.money, "owner", "sales.unblockBuyer", { buyerId: s.buyerId });
        continue;
      }
      if (story.add(addFarmDays(remitOn, 2), RANK.money, "manager", "sales.setInstrumentState", { id: id(), instrumentId: s.instrument.id, state: "cashed", day: addFarmDays(remitOn, 2) })) story.flow(addFarmDays(remitOn, 2), { bank: s.total });
    } else if (s.method === "credit") credits.push({ buyerId: s.buyerId, day: addFarmDays(s.day, rng.int(8, 21)), amount: s.total, method: rng.chance(0.6) ? "cash" : "transfer" });
  }
  for (const c of credits)
    story.add(c.day, RANK.money, "manager", "sales.recordPayment", { id: id(), buyerId: c.buyerId, day: c.day, amountCentimes: String(c.amount), method: c.method, instrument: null }, c.method === "cash" ? { cash: c.amount } : { bank: c.amount });
}
