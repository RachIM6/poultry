import { can } from "@/lib/permissions";
import { defineMutation, type SyncRegistry } from "@/lib/sync/server";
import { createTreasuryAccount, recordExpense, recordTransfer } from "@/modules/finance/application/treasury";
import { CreateTreasuryAccount, FINANCE_MUTATIONS as M, RecordExpense, RecordTransfer, type ExpenseDto, type TransferDto, type TreasuryAccountDto } from "@/modules/finance/schema";

// SPEC-finance FX2: owners and managers record expenses and treasury moves, offline (FX4). Workers get none of it,
// neither the mutations nor the records.
const forFinance = <T,>(ctx: Parameters<typeof can>[0], data: T) => (can(ctx, "money.read") ? data : undefined);

export const financeSync: SyncRegistry = {
  mutations: {
    [M.createTreasuryAccount]: defineMutation({ schema: CreateTreasuryAccount, action: "finance.record", apply: (tx, ctx, cmd, meta) => createTreasuryAccount(tx, ctx, cmd, meta) }),
    [M.recordExpense]: defineMutation({ schema: RecordExpense, action: "finance.record", apply: (tx, ctx, cmd, meta) => recordExpense(tx, ctx, cmd, meta) }),
    [M.recordTransfer]: defineMutation({ schema: RecordTransfer, action: "finance.record", apply: (tx, ctx, cmd, meta) => recordTransfer(tx, ctx, cmd, meta) }),
  },
  entities: {
    treasuryAccount: (ctx, data: TreasuryAccountDto) => forFinance(ctx, data),
    expense: (ctx, data: ExpenseDto) => forFinance(ctx, data),
    transfer: (ctx, data: TransferDto) => forFinance(ctx, data),
  },
};
