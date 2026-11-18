# ADR-011: Partners (vet, accountant) are members with two new roles, an active organisation and a pull allowlist

## Status
Proposed (written while the owner was away, 2026-11-18; to be reviewed with SPEC-m5)

## Date
2026-11-18

## Context
- SCOPE §20 and CAPABILITY-MAP M5: the farmer's vet and accountant need access to the farm's data, "with scoped permissions and the farmer's consent".
- A vet or accountant serves several farms, each its own organisation (ADR-006). Today `getTenantContext` takes the user's oldest membership, with a note to add a switcher in M5.
- Permissions live in one role → action table (`src/lib/permissions.ts`), and each synced entity has one serializer that can drop fields or the whole record (`withoutMoney`, `can`).
- The offline phone keeps one IndexedDB per `userId:organizationId` scope (ADR-003), so two organisations on one phone are already kept apart.

## Decision
- **Partners are members.** `MemberRole` gains `vet` and `accountant`. The owner invites them through the existing phone invitation; the invitation is the consent. `Membership` and `Invitation` gain an optional `accessUntil`; a membership past it does not open the organisation.
- **Active organisation:** a user with several memberships picks one; the choice is an organisation id in a signed, httpOnly cookie, and `getTenantContext` uses it only when it matches a live membership of the session's user, else the oldest live membership. Changing it is a same-origin POST.
- **Actions:** the two roles join the existing table (SPEC-m5 §5). No action is checked by role name anywhere else.
- **Pull allowlist:** the sync pull, the one place every change is serialized, skips any entity not on the partner role's list. A new entity is invisible to partners until it is added to the list on purpose.
- **No farm-level scope yet** (SPEC-m5 NQ1): a partner sees the whole organisation, like a manager.

## Alternatives Considered
- **A separate partner model** (grants per farm and per data type, outside memberships): finer, but a second permission system beside `can()`, and every entity filter would need it. Rejected until NQ1 says farms need it.
- **Read-only exports only for partners:** simple for the accountant, but the vet records vaccinations and treatments offline like a worker. Rejected.
- **Filtering partners in each serializer:** dozens of serializers to keep right; an allowlist at the pull is one place and fails closed.

## Consequences
- Every new synced entity must decide whether partners see it (the allowlist test lists what they receive).
- Two more roles in `can()` add a few bytes to the shared JS; `/batches` has about 0.4 KB of margin (`e2e/budget.spec.ts`).
- Removing a partner is removing a member; their phone's local copy stays until they sign out, as for any removed member (ADR-007 applies).
