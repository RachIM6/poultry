# ADR-004: Arabic (RTL, default) and French; Darija deferred

## Status
Accepted

## Date
2026-10-27

## Context
- Moroccan farmers read Arabic and/or French.
- The product owner decided **not to include Darija** in v1 (see CLAUDE.md, learned rules).
- Arabic needs a right-to-left layout.
- The interface also shows numbers, money, dates and units everywhere.

## Decision
- **next-intl** with locales `ar` (default) and `fr`, routed as `/[locale]/...`. The user's choice is stored on their profile.
- `<html lang dir>` is set per locale. Layouts use **Tailwind logical utilities** (`ms-*`, `me-*`, `ps-*`, `start-*`…), never `left` / `right`.
- **Western digits (0–9)** in both locales: `ar-MA` with `numberingSystem: 'latn'`.
  - Money is shown as `1 234,50 DH`.
  - Dates use the Gregorian calendar, in the `Africa/Casablanca` time zone.
- All strings live in `messages/ar.json` and `messages/fr.json`. CI fails if a key is missing in either file.

## Alternatives Considered
- **Arabic + French + Darija:** rejected for v1 by the product owner. Revisit with the assistant / voice module.
- **French only at first:** rejected. Arabic is required for many farmers and workers.

## Consequences
- Every UI change is checked in both directions (LTR and RTL) at the checkpoints.
- Icons that show direction (arrows, chevrons) must be mirrored in RTL.
- Seasonal planning (M5) will need **Hijri dates** to show Ramadan and the Eids. That is display only, using the `islamic` calendar of `Intl`.
