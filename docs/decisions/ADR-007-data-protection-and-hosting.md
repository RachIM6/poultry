# ADR-007: Personal data protection (law 09-08) and hosting location

## Status
Proposed. Hosting is **open** (SPEC OQ1). The legal points need validation by a lawyer. The hosting part ("Before the pilot", points 2 and 3) is superseded by [ADR-016](ADR-016-hosting-and-transfers.md) (2026-11-24): synthetic data only on the Vercel + Supabase demo, and the steps before any real data.

## Date
2026-10-27

## Context
- The platform stores personal data: names and phone numbers of farmers, workers and buyers; workers' pay; location of farms.
- Moroccan **law 09-08** governs personal data, and the **CNDP** is the supervisory authority.
- ⚠️ To validate: processing generally requires a prior declaration or authorization at the CNDP, and **transfers of personal data abroad** are restricted and may need an authorization.
- Hosting choice therefore has legal and cost consequences.

## Decision (current)
- **Data minimisation.**
  - Only the phone number is required.
  - Buyer and worker records keep only what the features need.
  - National ID (CIN) numbers are not stored.
- **Farmer owns the data.**
  - Full export (JSON + CSV) at any time: `pnpm org:export` ([data requests](../data-requests.md)).
  - Deleting an organisation removes all its data, including the audit log, 30 days after it left (`pnpm org:left`, then `pnpm org:delete`).
    - **Except the books.** Decided default (2026-11-24), to review. Law 9-88 art. 22 has accounting documents and supporting documents kept for ten years. So the ledger, its supporting records and receipts stay, read-only, for 10 years after the end of their fiscal year, with phones erased. The table-by-table list is in [data requests](../data-requests.md).
  - Partners (vet, accountant) get access only with the owner's consent (M5).
- **Retention while the organisation is active.** Decided default (2026-11-24), to review. Law 09-08 art. 3-1-e: data is kept no longer than its purpose needs. A daily scheduler step (`src/ops/retention.ts`) deletes:
  - the login log (`AuthEvent`) after **12 months**, the CNDP's period for time-stamped entries to private premises (deliberation D-943-2025);
  - rate-limit hits after their longest window, expired sessions and expired login codes;
  - notifications **90 days** after they were read, or after **1 year** unread, with a deletion in the sync log so phones drop them;
  - the audit of farm operations after **5 years**: the health register's 1–2 years (arrêté 2126-05) and the 5-year commercial prescription (Code de commerce art. 5).
  - It keeps the audit of the books and of anything not classified, which follows the books' ten years, and the sync log (`Change`, ADR-014), which goes with the organisation.
  - The table, the reasons and the sources are in [data requests](../data-requests.md#retention-periods-while-the-organisation-is-active).
- **Before the pilot:**
  1. File the CNDP declaration or authorization.
  2. Choose hosting:
     - **(a)** a provider with a data centre **in Morocco**, or
     - **(b)** abroad, with the transfer authorization.
  3. Record the choice in a new ADR that supersedes this one.
- **Until then**, development and test data are **synthetic only**, with no real farm data.

## Alternatives Considered
- **Host abroad with no CNDP steps:** rejected. It is a legal risk and a trust risk with farmers.
- **Decide hosting later, after the pilot:** rejected. The pilot already uses real personal data.

## Consequences
- The pilot deployment (T25) is blocked until OQ1 is resolved.
- Every external provider (SMS / WhatsApp, error tracking, analytics) is also a data processor and must be listed in the CNDP file. This is why adding one is on the "ask first" list.
