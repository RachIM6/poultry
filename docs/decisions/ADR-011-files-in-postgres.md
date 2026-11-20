# ADR-011: Uploaded files live in PostgreSQL until hosting is chosen

## Status
Proposed (2026-11-16, T43). To revisit with hosting (OQ1, ADR-007).

## Date
2026-11-16

## Context
- M2 compliance needs files: the rodent-control proof photo (law 49-99 art. 15, SPEC-m2-compliance BS8) and the vault's scanned documents (DC1–DC2).
- Hosting and its object storage are deferred (OQ1). An external storage service is "ask first" (SPEC §7) and a data processor under law 09-08 (ADR-007).
- Files are few and small at pilot scale: a photo per rodent check, a few dozen documents per farm.
- The sync protocol is JSON; changing it is "ask first" too.

## Decision
- A `StoredFile` table owned by `documents`: the bytes (`bytea`), the type read from the file's own first bytes, size, SHA-256, organisation, uploader, and a purpose (`proof` for every member, `document` for owners and managers).
- One upload route, `POST /api/files`, online only: the file is the request body (no multipart), read with a **5 MB cap**; PDF, JPEG, PNG, WebP only, by magic bytes; same-origin + `X-Requested-With` (poultry-auth §4); rate-limited per user.
- One download route, `GET /api/files/<id>`: tenant- and role-scoped, anything else is 404; always `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- A proof is attached to its record by the upload route itself, so a record only ever points at a file its organisation just uploaded. Records are created offline as usual; the photo waits until the record is on the server and the phone is online.

## Consequences
- No new dependency or external service; backups of the database include the files.
- The database grows with files. Fine for the pilot; when hosting comes, moving the bytes to object storage changes `documents/service.ts` and nothing else.
- Photos taken offline aren't queued: the farmer adds them once there is network (the record says "preuve à ajouter" until then). A queued upload can come later without changing the sync protocol.
