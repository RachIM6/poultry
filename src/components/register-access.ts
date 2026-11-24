import { can } from "@/lib/permissions";
import { pulls } from "@/lib/sync/views";
import type { TenantContext } from "@/lib/tenant";

// SPEC-m2-compliance RP2: what a batch's register is built from on the phone (src/components/register-document.tsx).
export const REGISTER_ENTITIES = ["farm", "house", "batch", "dailyEntry", "vaccination", "treatment", "vetVisit", "soldBirds", "sale", "buyer", "disposal", "document", "stockItem", "eggCollection"];

/** Whether this phone holds the whole register: every entity in the role's pull, and the vault's documents, which reach only their readers. */
export const wholeRegister = (ctx: TenantContext) => can(ctx, "documents.manage") && REGISTER_ENTITIES.every((e) => pulls(ctx.role, e));
