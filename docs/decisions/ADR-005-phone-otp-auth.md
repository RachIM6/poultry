# ADR-005: Phone number + one-time code, database sessions

## Status
Proposed. The library choice and the SMS / WhatsApp provider are still open (SPEC OQ2).

## Date
2026-10-27

## Context
- Many farmers and workers have no email address, or never check it. Every user has a mobile number, and most use WhatsApp.
- Workers share phones and change jobs.
- Offline use means a session must last for days without contacting the server.

## Decision
- **Identifier:** a Moroccan mobile number in E.164 format (`+2126…` / `+2127…`). Email is optional.
- **Login:** a 6-digit one-time code (OTP), sent by SMS or WhatsApp.
  - The code is stored **hashed**.
  - It expires after 5 min.
  - It is locked after 5 wrong attempts.
  - A number can request at most 3 codes per 15 min. There is also a limit per IP.
  - In development, codes are printed to the server console. **They are never logged in production.**
- **Sessions:** a random token stored in a `Session` table, sent in a cookie (`httpOnly`, `Secure`, `SameSite=Lax`).
  - A session lasts 30 days, renewed on each online use.
  - The owner can revoke the sessions of any member.
- **Offline:** the client caches the user, the memberships and the permissions. A session that expired while offline keeps local entries queued until the user logs in again.
- **Library:** build on a maintained auth library with phone-OTP support (Better Auth is the candidate) rather than writing session handling from scratch. This is confirmed in task T5, where the alternative is evaluated as well.

- **Abuse protection** follows `.claude/skills/poultry-auth/` (added on 2026-10-27, adapted from the EMSI `cdoc-auth` skill). On top of the per-number limits, it adds:
  - multi-dimensional rate limits (IP, subnet, phone, number prefix, global);
  - protection against **SMS pumping**: Moroccan mobile numbers only, plus a global hourly cost cap with an alert;
  - a self-hosted captcha (ALTCHA candidate) on code requests;
  - uniform responses;
  - a 90-day absolute session cap;
  - CSRF checks on route handlers.

## Alternatives Considered
- **Email + password:** rejected. It doesn't match the users, and passwords on shared phones are a risk.
- **Password-less login by email link:** rejected for the same reason.
- **JWT stored on the client:** rejected. It is harder to revoke when a worker leaves, and database sessions are simple enough.

## Consequences
- SMS / WhatsApp messages cost money, and the per-number limits protect both cost and security.
- The production provider must be chosen before the pilot (OQ2).
- Losing access to a phone number is a support case: an owner can re-invite a member under a new number.
