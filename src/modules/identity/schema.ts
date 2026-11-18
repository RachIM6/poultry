import { z } from "zod";

export const ROLES = ["owner", "manager", "worker", "vet", "accountant"] as const;
export const PARTNER_ROLES: readonly string[] = ["vet", "accountant"]; // SPEC-m5, ADR-011

// Phone format is checked by PhoneNumber after parsing, so the error can be INVALID_PHONE rather than INVALID_INPUT.
// An end day only for a partner (PA1); "" from the form means none. Not in the past: checked with the clock.
export const InviteMember = z
  .object({ phone: z.string().max(32), role: z.enum(ROLES), accessUntil: z.iso.date().or(z.literal("")).nullish().transform((d) => d || null) })
  .refine((i) => i.accessUntil === null || PARTNER_ROLES.includes(i.role), "an end day is for partners");
export const ChangeRole = z.object({ membershipId: z.uuid(), role: z.enum(ROLES) });
export const RemoveMember = z.object({ membershipId: z.uuid() });
export const CancelInvitation = z.object({ invitationId: z.uuid() });
