import { z } from "zod";

export const ROLES = ["owner", "manager", "worker", "vet", "accountant"] as const;
export const PARTNER_ROLES: readonly string[] = ["vet", "accountant"]; // SPEC-m5, ADR-013

// Phone format is checked by PhoneNumber after parsing, so the error can be INVALID_PHONE rather than INVALID_INPUT.
// An end day only for a partner (PA1); "" from the form means none. Not in the past: checked with the clock.
export const InviteMember = z
  .object({ phone: z.string().max(32), role: z.enum(ROLES), accessUntil: z.iso.date().or(z.literal("")).nullish().transform((d) => d || null) })
  .refine((i) => i.accessUntil === null || PARTNER_ROLES.includes(i.role), "an end day is for partners");
export const ChangeRole = z.object({ membershipId: z.uuid(), role: z.enum(ROLES) });
export const RemoveMember = z.object({ membershipId: z.uuid() });
export const CancelInvitation = z.object({ invitationId: z.uuid() });
export const ResetPassword = z.object({ membershipId: z.uuid() }); // ADR-015: the owner issues a reset code
export const SaveLocale = z.object({ locale: z.enum(["ar", "fr"]) }); // ADR-004: no Darija in v1

// A person's first and last name, shown to the farm's other members: letters of any script (Latin, Arabic) and their
// accents, words joined by one space, a hyphen or an apostrophe. No digits, markup or invisible characters.
export const NAME_MAX = 50;
const PersonName = z
  .string()
  .max(4 * NAME_MAX)
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(NAME_MAX).regex(/^\p{L}\p{M}*(?:[ '’-]?\p{L}\p{M}*)*$/u));
/** `name`: « Prénom Nom », the display name Better Auth's required `name` holds (it was the phone before). */
export const Names = z.object({ firstName: PersonName, lastName: PersonName }).transform((n) => ({ ...n, name: `${n.firstName} ${n.lastName}` }));
