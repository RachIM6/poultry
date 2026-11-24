import type { Role } from "@/lib/tenant";

// SPEC-m5 PA4, PA5 (ADR-013): what a partner's phone receives; anything else, a new entity included, never leaves.
// The pull (src/app/api/sync/registry.ts) enforces it; the screens read it to show only what the phone can hold.
export const PULL_VIEWS: Partial<Record<Role, readonly string[]>> = {
  vet: ["farm", "house", "batch", "dailyEntry", "weighing", "soldBirds", "protocol", "vaccination", "treatment", "vetVisit", "stockItem", "movement", "notification"],
  accountant: [
    "farm", "house", "batch", "soldBirds", "batchCost", "supplier", "stockItem", "movement", "purchase", "supplierPayment", "issuedDebit", "buyer", "sale", "buyerPayment", "instrumentStatus",
    "treasuryAccount", "expense", "transfer", "employee", "advance", "payMonth", "payPayment", "labourRules", "price", "notification",
  ],
};

/** Whether the role's phone receives this entity (a serializer may still drop fields or records, e.g. money for workers). */
export const pulls = (role: Role, entity: string) => PULL_VIEWS[role]?.includes(entity) ?? true;
