import { z } from "zod";

// ADR-003 wire format, shared by the sync client (T9) and the route handlers. Changing it is "ask first" (SPEC §7).

export const MAX_MUTATIONS_PER_PUSH = 500; // poultry-auth rate-limiting.md §3
export const PULL_PAGE = 1000;

export const PushBody = z.object({
  mutations: z
    .array(
      z.object({
        id: z.uuid(), // UUIDv7 from the device: the idempotency key
        type: z.string().max(64), // "<module>.<action>", e.g. "farm-registry.saveFarm"
        payload: z.unknown(),
        createdAt: z.iso.datetime({ offset: true }), // device clock, kept for the audit log only
      }),
    )
    .max(MAX_MUTATIONS_PER_PUSH),
});
export type PushedMutation = z.infer<typeof PushBody>["mutations"][number];

export type MutationResult = { status: "applied" } | { status: "rejected"; messageKey: string };
/** Results come back in push order. Fewer results than mutations: the server stopped on an error; retry the rest. */
export type PushResponse = { results: ({ id: string } & MutationResult)[] };

export const PullQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });
/** `version` is the cursor for the next pull. `data: null` means the record was deleted. */
export type PullResponse = {
  version: number;
  hasMore: boolean;
  changes: { entity: string; id: string; version: number; data: unknown }[];
};
