import type { Posting } from "@/modules/finance/domain/posting";
import { treasuryKindOfAccount, type TreasuryKind } from "@/modules/finance/domain/treasury";

// SPEC-finance FN6, FQ11 (§9 "Associate contributions"): money an associate or the exploitant brings in or takes out, pure.

/** 4463 Comptes courants des associés créditeurs: "fonds laissés par les associés à la disposition de l'entreprise" (PCA p. 107). */
export const ASSOCIATES = "4463";
/**
 * FQ11: 1117 Capital personnel, "crédité du montant des apports de l'entrepreneur au début ou en cours d'activité […] et
 * débité des prélèvements de toute nature effectués par l'entrepreneur" (PCA p. 72; nomenclature 111, p. 53).
 */
export const EXPLOITANT = "1117";

export type AssociateDirection = "contribution" | "withdrawal";

/** The individual exploitant's own account; every other legal form's associates' current accounts. */
export const ownerAccountOf = (individual: boolean) => (individual ? EXPLOITANT : ASSOCIATES);

/** FN3, FQ11: a `cash_book` entity's manual entry is its opening bank and cash balances, against the owner's account. */
export const cashBookAccount = (account: string, individual: boolean) => treasuryKindOfAccount(account) !== null || account === ownerAccountOf(individual);

const CASH: Record<TreasuryKind, { account: string; journal: Posting["journal"] }> = { bank: { account: "5141", journal: "BQ" }, cash: { account: "5161", journal: "CA" } };

/** A contribution: D 5141 or 5161 / C the owner's account; a withdrawal the reverse. Tagged with the cash box or bank account (FN3). */
export function associatePosting(m: { direction: AssociateDirection; amount: bigint; treasury: { id: string; kind: TreasuryKind }; individual: boolean; associate: string | null }): Posting {
  const cash = CASH[m.treasury.kind];
  const owner = ownerAccountOf(m.individual);
  const what = `${m.direction === "contribution" ? "Apport" : "Retrait"} de ${m.individual ? "l'exploitant" : "l'associé"}`;
  const [debit, credit] = m.direction === "contribution" ? [cash.account, owner] : [owner, cash.account];
  const tag = (account: string) => (account === cash.account ? m.treasury.id : null);
  return {
    journal: cash.journal,
    label: m.associate ? `${what} : ${m.associate}` : what,
    lines: [
      { account: debit, debit: m.amount, credit: 0n, treasuryId: tag(debit) },
      { account: credit, debit: 0n, credit: m.amount, treasuryId: tag(credit) },
    ],
  };
}
