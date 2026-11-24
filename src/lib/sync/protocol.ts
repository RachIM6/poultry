// ADR-003 wire format (with ADR-014's additions), shared by the sync client (T9) and the route handlers. Changing it is
// "ask first" (SPEC §7).
// No Zod here (ADR-009): the phone loads this file; the request schemas live in the two route handlers.

export const MAX_MUTATIONS_PER_PUSH = 500; // poultry-auth rate-limiting.md §3

/**
 * "<userId>:<organizationId>" of the local database the request comes from. The server answers 409 when it isn't the
 * session's, so a shared phone never pushes or pulls one user's data with another user's session (T9).
 */
export const SCOPE_HEADER = "x-sync-scope";
export const PULL_PAGE = 1000;
/** ADR-014: the most records a `GET /api/sync/pull?records=<entity>:<id>,...` reads back at once (a refused write's). */
export const MAX_PULL_RECORDS = 100;

export type PushedMutation = {
  id: string; // UUIDv7 from the device: the idempotency key
  type: string; // "<module>.<action>", e.g. "farm-registry.saveFarm"
  payload: unknown;
  createdAt: string; // device clock (ISO with offset), kept for the audit log only
};

/** `messageValues` (optional, added 2026-11-23): the rejection's message values, e.g. V6's `days` ("2026-11-12,2026-11-13"). */
export type MutationResult = { status: "applied" } | { status: "rejected"; messageKey: string; messageValues?: Record<string, string | number> };
/** Results come back in push order. Fewer results than mutations: the server stopped on an error; retry the rest. */
export type PushResponse = { results: ({ id: string } & MutationResult)[] };

/**
 * `version` is the cursor for the next pull. `data: null` means the record was deleted. Since ADR-014 a page holds the
 * latest change of each record only; `since=0&snapshot=1` also leaves deleted records out (the phone then replaces its
 * copy). A `records` pull returns those records' latest changes and its `version` is not a cursor. Same shape as
 * before, so older phones keep working.
 */
export type PullResponse = {
  version: number;
  hasMore: boolean;
  changes: { entity: string; id: string; version: number; data: unknown }[];
};
