# ADR-007: Personal data protection (law 09-08) and hosting location

## Status
Proposed. Hosting is **open** (SPEC OQ1). The legal points need validation by a lawyer.

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
