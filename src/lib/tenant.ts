// ADR-006: who is acting, for which organisation. Built once per request by identity's getTenantContext();
// every farm-data read and write takes it. Plain types so the offline client can use them too.
export type Role = "owner" | "manager" | "worker" | "vet" | "accountant"; // vet, accountant: partners (ADR-011)

export type TenantContext = { userId: string; organizationId: string; role: Role };
