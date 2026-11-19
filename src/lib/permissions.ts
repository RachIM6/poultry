import type { Role, TenantContext } from "./tenant";

// SPEC I5 role → action table, the only place roles are checked (poultry-auth §1). Never compare role names inline.
const ALLOWED = {
  "organization.read": ["owner", "manager", "worker", "vet", "accountant"], // vet, accountant: SPEC-m5 §5
  "organization.manage": ["owner"], // a manager does everything except organisation settings and members
  "members.manage": ["owner"],
  "farms.manage": ["owner", "manager"], // create and edit farms and houses; workers see them
  "protocols.manage": ["owner", "manager", "vet"], // copy and edit vaccination protocols; workers see them
  "stock.manage": ["owner", "manager"], // suppliers, purchases, corrections; workers see quantities (I5)
  "flock.manage": ["owner", "manager"], // place batches (B1); workers see them and enter daily data (I5)
  "flock.record": ["owner", "manager", "worker"], // daily entries (B2), weighings (B3): the worker's job
  "health.manage": ["owner", "manager", "vet"], // a batch's vaccination plan (H1), with its placement
  "health.record": ["owner", "manager", "worker", "vet"], // vaccinations given (H2), treatments (H3), vet visits (H5), I5
  "sales.manage": ["owner", "manager"], // buyers and sales (V1–V3): prices and amounts, so never workers (I5)
  "money.read": ["owner", "manager", "accountant"], // prices, costs, sale amounts, supplier credit
  "prices.record": ["owner", "manager"], // the farm's price log (SPEC-m5 MP1)
  "finance.record": ["owner", "manager"], // entries, expenses, payments, cheques (SPEC-finance FX2); never workers
  "finance.manage": ["owner"], // periods, the accounting profile, overrides, credit limits, opening a fiscal year
  "workforce.manage": ["owner", "manager"], // employees, routines, attendance, advances, pay (SPEC-m4 §6); wages never reach workers
  "workforce.record": ["owner", "manager", "worker"], // ticking tasks, checking in (SPEC-m4 WF6, WF9)
  "workforce.validatePay": ["owner"], // freezes a month's pay (SPEC-m4 WF12)
  "labour.manage": ["owner"], // SMAG, contribution rates and cap, from the owner's source (SPEC-m4 §2)
  "climate.record": ["owner", "manager", "worker"], // readings and power cuts (SPEC-m4 CL2, CL5)
  "climate.manage": ["owner"], // climate targets from the owner's source (SPEC-m4 CL1)
} satisfies Record<string, Role[]>;

export type Action = keyof typeof ALLOWED;

export const can = (ctx: TenantContext, action: Action) => (ALLOWED[action] as Role[]).includes(ctx.role);

/**
 * SPEC I5: workers never receive money. Every serializer passes its money fields here, so they are dropped on the
 * server, not hidden in the UI. Name the fields optional in the DTO type.
 */
export function withoutMoney<T extends object>(ctx: TenantContext, dto: T, moneyFields: readonly (keyof T)[]): T {
  if (can(ctx, "money.read")) return dto;
  const copy = { ...dto };
  for (const field of moneyFields) delete copy[field];
  return copy;
}
