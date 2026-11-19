import { z } from "zod";

export const ROLES = ["owner", "manager", "worker"] as const;

// Phone format is checked by PhoneNumber after parsing, so the error can be INVALID_PHONE rather than INVALID_INPUT.
export const InviteMember = z.object({ phone: z.string().max(32), role: z.enum(ROLES) });
export const ChangeRole = z.object({ membershipId: z.uuid(), role: z.enum(ROLES) });
export const RemoveMember = z.object({ membershipId: z.uuid() });
export const CancelInvitation = z.object({ invitationId: z.uuid() });
