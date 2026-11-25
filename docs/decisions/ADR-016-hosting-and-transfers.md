# ADR-016: Hosting and transfers abroad (law 09-08): synthetic data on the Vercel + Supabase demo

## Status
Accepted (decided default, to review). Decided 2026-11-24 under the product owner's instruction of the same day: don't wait for the experts, read the official sources, decide, and put the client demo on Vercel + Supabase first. Supersedes the hosting part of [ADR-007](ADR-007-data-protection-and-hosting.md) ("Before the pilot", points 2 and 3). ADR-007's other points stand. The legal reading still needs a lawyer.

## Date
2026-11-24

## Context
- The client demo runs on **Vercel** (the Next.js app) and **Supabase** (Postgres). Both are US companies.
- Sources: [study of 2026-11-24](../studies/expert-free-defaults-2026-11-24.md), section 3. The texts below were re-read for this ADR, from the CNDP's and adala.justice.gov.ma's PDFs, on 2026-11-24.
- **Law 09-08, art. 43:** a responsable may transfer personal data to a foreign State only if that State "assure un niveau de protection suffisant". The CNDP keeps the list of those States.
- **Law 09-08, art. 44:** the exceptions. The person's express consent, a listed necessity (a contract with the person, for one), an agreement Morocco is party to, or the CNDP's "autorisation expresse et motivée", notably because of contractual clauses.
- **Délibération n° 236-2015 of 18/12/2015** (amends 465-2013) lists 32 States: 27 of the 28 EU members of 2015 (Croatia is missing; the United Kingdom is listed), Iceland, Liechtenstein, Norway, Switzerland and Canada. **The United States is not on the list.** No later amendment was found; that is a search result, not a confirmation.
- **Even a listed State needs a notification.** Délibération 236-2015, art. 1, opens with « Sous réserve de notifier à la CNDP, suivant le régime approprié, tout transfert de données à caractère personnel vers l'étranger ». The model délibérations say the same: 298-AU-2014 art. 10 (HR) names hosting abroad, « notamment dans le cas d'hébergement ou de stockage des données sur des serveurs situés à l'extérieur du territoire national »; 32-2015 §9 (customers) and 98-AU-2015 §9 (suppliers) too.
- **The form is F-118** (« Demande de transfert de données à l'étranger », law art. 43 and 44). Forms F-113 and F-214 say the transfer form goes with the filing. F-113 adds that a transfer is allowed only once the CNDP's express agreement arrives, « à travers un récépissé de transfert de données à l'étranger ».
- **Timing:** an authorisation is decided within two months (décret n° 2-09-165, art. 24, quoted in the footnotes of the consolidated law). A transfer authorisation follows the same procedure (décret art. 48).
- **Sanctions:** a transfer in breach of art. 43–44 is punished by 3 months to 1 year and/or 20 000 to 200 000 DH (art. 60), doubled for a legal person (art. 64).
- **Vercel's defaults:** functions run in `iad1` (Washington, D.C.) unless a region is set ([Vercel, "Global network and regions"](https://vercel.com/docs/regions), read 2026-11-24). Vercel and Supabase both offer Paris (`cdg1` / `eu-west-3`) and Frankfurt (`fra1` / `eu-central-1`). France and Germany are on the 236-2015 list.

## Decision

### 1. The demo holds synthetic data only
- No real farm, employee, buyer, supplier, visitor, vet or phone number goes into the demo, not even "just to try".
- This is ADR-007's rule ("development and test data are synthetic only"), applied to the demo host.
- The demo is seeded with `pnpm db:seed:demo` (made-up figures, `prisma/demo.ts`).
- The person who presents logs in with the demo account (`DEMO_PHONE`), so no real phone number reaches an SMS provider or the host's logs.
- `DEMO_MODE=1` puts a banner on every signed-in page: « Démonstration — données fictives uniquement » / « عرض توضيحي — بيانات وهمية فقط ». Anyone who sees the demo is told not to type real data.

### 2. Pick EU regions even for the demo
- Supabase project in `eu-west-3` (Paris), Vercel function region `cdg1` (Paris). Frankfurt (`eu-central-1` / `fra1`) is the fallback.
- That limits the exposure if real data slips in. It does **not** replace the notification: a US company still runs both, and an EU transfer is still notified (above).

### 3. Before any real data (the pilot)
Either:
- **(a) host in Morocco**, which needs no F-118 for the hosting; or
- **(b) stay abroad**, in a listed State, after:
  1. each farm's filings, and the publisher's own ([docs/cndp](../cndp/README.md));
  2. one **F-118** per foreign recipient (hosting, database, SMS provider), filed with the farm's filings;
  3. the CNDP's answer, a « récépissé de transfert » (up to two months);
  4. the **art. 23 contract** between each farm (responsable) and the publisher (sous-traitant), with the providers named as sub-processors ([template](../cndp/contrat-sous-traitance.md)).
- A US region is not an option without the CNDP's express authorisation under art. 44.3, which asks for the provider's contractual clauses and a reasoned decision.
- The choice is recorded in a new ADR that supersedes this one (OQ1 stays open until then).

## Alternatives considered
- **Real pilot data on the demo stack with no filing:** rejected. It is an offence (art. 52, 60) and a trust risk with farmers.
- **Vercel's default region (`iad1`) for the demo:** rejected. The data is synthetic, but the same project would become the pilot's; set the region once, now.
- **Wait for OQ1 before any demo:** rejected. The product owner wants the demo first, and synthetic data carries no personal data.

## Consequences
- The demo can go up now, on synthetic data, with the banner on.
- The pilot stays blocked by: the filings, the art. 23 contracts, the hosting choice (OQ1), and, for (b), the CNDP's answer on each F-118.
- Every new foreign provider (SMS, error tracking, analytics, email) adds an F-118 and a line in the art. 23 contract. Adding one stays on the "ask first" list (ADR-007).
- Not checked here: whether Vercel's own logs, build system or support access hold data outside the chosen region. Read the providers' data processing agreements before the F-118, and attach them (F-118 part VI).
