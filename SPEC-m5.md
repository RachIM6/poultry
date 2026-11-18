# Spec: M5 "Network" (`partner-access`, `market-prices`, `planning`)

_v0.1, 18 Nov 2026. Status: **draft**, written without the owner (they asked for work to continue while away); every choice made without them is marked ⚠️ or listed in §8. Milestone M5 of [CAPABILITY-MAP.md](CAPABILITY-MAP.md): `partner-access` depends on `identity`, `farm-registry`; `market-prices` on `identity`, `reference-data`; `planning` on `flock`, `market-prices`, `notifications`. Background: [SCOPE.md](SCOPE.md) §3, §10, §19, §20 and [NEEDS-ANALYSIS.md](NEEDS-ANALYSIS.md). Conventions, stack and boundaries from [SPEC.md](SPEC.md) apply unchanged. Plan: [tasks/plan-m5.md](tasks/plan-m5.md). Decision: [ADR-011](docs/decisions/ADR-011-partner-access.md)._

## 1. Objective

The farm opens to the two outside people it already works with, and plans ahead:
- the owner **invites their vet and their accountant** by phone, as they invite a worker; the vet sees the batches and their health and records vaccinations, treatments and visits; the accountant sees the money and exports the books; neither sees more, and the owner can end the access at any time or set an end date;
- a vet or accountant who serves several farms **switches between them** on one phone, each farm's data kept apart;
- the owner or manager **logs the prices they see** (chicks, feed, live birds, eggs, cull hens) and reads their history;
- the owner or manager **plans the next batches** per house: placement day, chicks booked from the hatchery, planned sale age; the plan warns about overlaps and too-short downtime, places the batch from the plan, and reminds the day before.

**Users:** owner, manager, worker (SPEC I4), and two new roles: **vet** and **accountant**. Workers never see prices (SPEC I5).

**Out of scope in M5** (each in §8 or "Later" of the plan): a regional price index across farms (consent and anonymity, NQ2), FISA price data (an external source: "ask first", NQ3), seasonality markers such as Ramadan and Eid (NQ5), the best selling day from growth and price (needs the growth curves, OQ5), farm-level scoping of a partner (NQ1), the vet's electronic signature of the register and prescriptions (NQ6), a partner's combined view across farms, and the bank or insurer read-only access of SCOPE §20.

## 2. Domain figures we do not invent

- **Downtime between two batches** in a house (vide sanitaire): the owner enters a minimum number of days per farm from their own source (vet, ONSSA guide). No value is seeded. Until it is entered, the planner shows the gap in days and gives no warning.
- **Prices** are what the owner or manager typed, with what they saw it on. The app computes no index, average across farms or forecast.

## 3. Concepts

| Concept | Module | Rule |
|---|---|---|
| **Partner** | identity, partner-access | A member with the role **vet** or **accountant**, invited by the owner's phone invitation (the farmer's consent is the invitation). Optional **access end date**: after it, the membership no longer opens the organisation |
| **Active organisation** | identity | A user with several memberships picks one; it is kept in a signed cookie and checked against their memberships on every request. Without a choice, the oldest membership (today's rule) |
| **Partner view** | partner-access | What a partner's phone receives on pull: an allowlist of entities per role (§5), applied at the one place the sync pull serializes changes |
| **Price observation** | market-prices | Product, farm, farm day, price per unit in centimes, what it was seen on (free text), who recorded it. Units are fixed per product (§6) |
| **Planned batch** | planning | House, planned placement day, chicks, strain, hatchery, booked chick price (optional), planned sale age in days (optional), status planned / placed / cancelled, and the batch it became |
| **Farm planning settings** | planning | Minimum downtime in days (§2), entered by the owner, dated and with a source |

## 4. `partner-access` and `identity` requirements

- **PA1.** The owner invites a member with the role vet or accountant (the existing invitation by phone), with an optional access end date. Only the owner (`members.manage`).
- **PA2.** A partner signs in with their phone as everyone does. With several memberships, the app lists the organisations and the user picks one; the choice is kept and can be changed from the menu. The server accepts only an organisation the user belongs to, whose access has not ended.
- **PA3.** After the end date, or once the owner removes the member, the partner's requests for that organisation are refused (`UNAUTHENTICATED` for the organisation, as for any lost membership), and their phone keeps no pull right.
- **PA4.** **Vet** (the actions in §5): reads farms, houses, batches, daily entries, weighings, the vaccination plans, vaccinations, treatments and withdrawal; records vaccinations, treatments and vet visits, edits protocols and a batch's plan. Never money, wages, staff or climate targets.
- **PA5.** **Accountant**: reads everything with money (purchases, stock value, sales, receivables, the books, advances, pay) and the batches they relate to; downloads the accountant's export (FN18). Records nothing.
- **PA6.** The members screen shows each partner's role and end date, and the owner removes them like any member. Every partner sign-in to an organisation is in the audit log.

## 5. Permissions (`src/lib/permissions.ts`) and the partner view

The two roles join the one role → action table. ⚠️ Chosen without the owner:

| Action | Adds | Why |
|---|---|---|
| `organization.read` | vet, accountant | they see whose farm it is |
| `health.manage`, `health.record`, `protocols.manage` | vet | the vet's own work (SCOPE §9, §20) |
| `money.read` | accountant | the books |

Every other action stays as it is: a partner creates no batch, entry, sale or payment. Pull: a vet receives only `farm`, `house`, `strain`, `batch`, `dailyEntry`, `weighing`, `protocol`, `vaccination`, `treatment`, `vetVisit`; an accountant only the entities finance, sales, inventory and pay hold, plus `farm`, `house`, `batch`. The exact names are taken from the registry when T91 is built; a test lists them.

## 6. `market-prices` requirements

- **MP1.** The owner or a manager records a price, offline: product (day-old chick per head, feed per kg, live broiler per kg, egg per egg, cull hen per head), farm, farm day, price, what it was seen on. Integer centimes; a price of zero is refused. Workers neither record nor receive prices; accountants receive them.
- **MP2.** `/prices`: per product, the latest price with its day and what it was seen on, and the change against the previous one; below, the history, newest first. Offline.
- **MP3.** Nothing leaves the organisation: no shared index (NQ2).

## 7. `planning` requirements

- **PL1.** The owner or a manager plans a batch for a house: placement day, chicks, strain, hatchery, booked chick price (optional), planned sale age (optional). Edited until placed; cancelled rather than deleted. Offline.
- **PL2.** `/planning`: per house, the open batch and the planned ones in date order, each with its placement day and, when the sale age is known, its planned sale day; the **gap** in days between one batch's sale day and the next placement. Warnings: a plan overlapping the open batch or another plan of the house; a gap shorter than the farm's minimum downtime when one is entered (§2). Without a sale age, the gap is unknown and no overlap is claimed.
- **PL3.** "Mettre en place" on a plan opens the placement form filled from the plan; saving it places the batch and marks the plan placed with the batch's id, in one mutation.
- **PL4.** The day before a planned placement, the owner and managers receive a notification ("Mise en place prévue demain : Bâtiment 1, 10 000 poussins, Couvoir X"), once, held by quiet hours.
- **PL5.** The owner enters the farm's minimum downtime, with its source; dated, never edited (§2).

## 8. Open questions

| # | Question | Blocks | Default until answered |
|---|---|---|---|
| NQ1 | Should a partner see only **some farms** of an organisation? | Farm scoping | The whole organisation |
| NQ2 | A **regional price index** across farms: do farmers consent to share their prices, anonymously, with how many farms at least per region and product before showing it? | Shared index | Not built; prices stay in the organisation |
| NQ3 | **FISA** or other published prices: which source, under what licence, how often? | Price import | Not built (external source: ask first) |
| NQ4 | Minimum **downtime** between batches, per farm or per production type, and its source | PL2 warning | Stored empty; gap shown, no warning |
| NQ5 | **Seasonality**: which events (Ramadan, Eid al-Adha, summer weddings), their dates in Morocco (moon sighting), and what the planner should say about them | Seasonal markers | Not shown |
| NQ6 | Does the vet need to **sign** the ONSSA register and prescriptions in the app, and what makes such a signature valid? | Sign-off | Not built |
| NQ7 | The accountant's **writes**: may they correct an entry, or only read and export? | Accountant actions | Read and export only |

## 9. Success criteria (M5 done)

1. A vet invited by two farms switches between them on one phone and sees each farm's batches and health only; never a price, a wage or a staff record (integration test on every entity the pull can send).
2. An accountant sees the money and downloads the export; any write they try is refused.
3. After the owner removes a partner, or after the end date, the partner's next request for that organisation is refused.
4. A batch planned offline, placed from the plan the day it comes, links plan and batch once; the reminder came the day before.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test`, each task's Playwright spec, and `e2e/budget.spec.ts` pass.
