import type { Role, TenantContext } from "./tenant";

// SPEC I5 role → action table, the only place roles are checked (poultry-auth §1). Never compare role names inline.
const ALLOWED = {
  "organization.read": ["owner", "manager", "worker"],
  "organization.manage": ["owner"], // a manager does everything except organisation settings and members
  "members.manage": ["owner"],
  "farms.manage": ["owner", "manager"], // create and edit farms and houses; workers see them
  "protocols.manage": ["owner", "manager"], // copy and edit vaccination protocols; workers see them
  "stock.manage": ["owner", "manager"], // suppliers, purchases, corrections; workers see quantities (I5)
  "flock.manage": ["owner", "manager"], // place batches (B1); workers see them and enter daily data (I5)
  "flock.record": ["owner", "manager", "worker"], // daily entries (B2), weighings (B3): the worker's job
  "health.manage": ["owner", "manager"], // a batch's vaccination plan (H1), with its placement
  "health.record": ["owner", "manager", "worker"], // vaccinations given (H2), treatments (H3), vet visits (H5), I5
  "money.read": ["owner", "manager"], // prices, costs, sale amounts, supplier credit
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
