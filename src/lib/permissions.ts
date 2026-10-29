import type { Role, TenantContext } from "./tenant";

// SPEC I5 role → action table, the only place roles are checked (poultry-auth §1). Never compare role names inline.
const ALLOWED = {
  "organization.read": ["owner", "manager", "worker"],
  "organization.manage": ["owner"], // a manager does everything except organisation settings and members
} satisfies Record<string, Role[]>;

export type Action = keyof typeof ALLOWED;

export const can = (ctx: TenantContext, action: Action) => (ALLOWED[action] as Role[]).includes(ctx.role);
