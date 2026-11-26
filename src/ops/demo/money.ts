import { db } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { bankReconciliation, importBankFile, matchBankLine } from "@/modules/finance";
import { must, today } from "./kit";

// The demo seed's reads of what finance just wrote, to type what the owner would read off paper (DEMO ONLY).

const dayOf = (d: Date) => d.toISOString().slice(0, 10) as FarmDay;

/** The installments due by today, with their due day: the bank debits each on its day. */
export async function loanInstallmentsDue(loanId: string): Promise<[number, FarmDay][]> {
  const rows = await db.loanInstallment.findMany({ where: { loanId, dueOn: { lte: new Date(`${today}T00:00:00Z`) } }, orderBy: { number: "asc" }, select: { number: true, dueOn: true } });
  return rows.map((r) => [r.number, dayOf(r.dueOn)]);
}

const amount = (c: bigint) => (c === 0n ? "" : `${c / 100n},${String(c % 100n).padStart(2, "0")}`);

/**
 * FC9: the bank's statement up to `endDay`, as a CSV export of the bank, built from the account's book lines (so they
 * pair) plus the bank's own fees not yet booked; imported, then the first two thirds of the lines ticked (partly
 * reconciled, as on the day the owner stopped).
 */
export async function importStatement(ctx: TenantContext, treasuryId: string, endDay: FarmDay, fees: bigint) {
  const lines = await db.journalLine.findMany({
    where: { organizationId: ctx.organizationId, account: "5141", treasuryId, entry: { day: { lte: new Date(`${endDay}T00:00:00Z`) } } },
    select: { debitCentimes: true, creditCentimes: true, entry: { select: { day: true, label: true } } },
    orderBy: [{ entry: { day: "asc" } }, { id: "asc" }],
  });
  const ascii = (s: string) => s.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/[;"]/g, " ").toUpperCase().slice(0, 60);
  const dmy = (d: FarmDay) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const rows = lines.map((l) => `${dmy(dayOf(l.entry.day))};${ascii(l.entry.label)};${amount(l.creditCentimes)};${amount(l.debitCentimes)}`); // the bank's debit is the book's credit
  rows.push(`${dmy(endDay)};FRAIS TENUE DE COMPTE TRIMESTRE;${amount(fees)};`);
  const closing = lines.reduce((s, l) => s + l.debitCentimes - l.creditCentimes, 0n) - fees;
  const csv = ["Date;Libelle;Debit;Credit", ...rows].join("\n");
  const mapping = { separator: ";", skipLines: 1, dateColumn: 1, dateFormat: "DD/MM/YYYY", labelColumn: 2, amountColumn: null, debitColumn: 3, creditColumn: 4, decimalComma: true };
  const imported = await importBankFile(ctx, { treasuryId, format: "csv", fileName: "releve-demo.csv", bytes: new TextEncoder().encode(csv), csv: { mapping, endDay, closingCentimes: String(closing) }, dryRun: false });
  if (!imported.ok) throw new Error(`demo: bank import ${JSON.stringify(imported)}`);
  const read = must("bank reconciliation", await bankReconciliation(ctx, treasuryId)).value;
  const pairs = (read.statement?.imported ?? []).flatMap((i) => (i.lineId ? [i.lineId] : []));
  const statementId = read.statement!.id;
  for (const lineId of pairs.slice(0, Math.ceil((pairs.length * 2) / 3))) must("bank tick", await matchBankLine(ctx, { statementId, lineId, ticked: true }));
  return { lines: rows.length, ticked: Math.ceil((pairs.length * 2) / 3) };
}
