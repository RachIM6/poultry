# Laying standards (SPEC-m3 R7, open question MQ1)

One JSON file per published laying table, named `<strain>-<version>.json`, validated by `LayingFile` in
`src/modules/reference-data/schema.ts`:

```json
{
  "strainId": "lohmann-brown",
  "source": "<document title>, <publisher>",
  "version": "<edition>",
  "points": [
    { "week": 20, "layingRatePermille": 0, "eggsPerHenHousedTenths": 0, "eggWeightDg": null, "feedGramsPerHenDay": 0, "bodyWeightGrams": 0 }
  ]
}
```

- One point per **week of age**, copied exactly from the breeder's management guide. Integers: hen-day laying rate in
  per mille (92.0 % = 920), cumulative eggs per hen housed in tenths (132.4 = 1324), egg weight in decigrams
  (61.8 g = 618), feed in grams per hen per day, body weight in grams. A column the guide doesn't give is `null`.
- Weeks may skip: the app interpolates between published weeks and never extrapolates.
- **No table is committed yet.** Values must never be typed from memory. Add the file, run `pnpm db:seed`, then
  spot-check 5 weeks against the document.
- Pullet growth by week goes in `../curves/` (day = week × 7), turkey growth per sex too (`"sex": "female"` or `"male"`).

## Licence status (MQ1 / OQ5, checked 2026-11-24)

The layer breeders’ tables are copyrighted and published without a licence for reuse in an app: Hy-Line (© Hy-Line
International, no licence given, https://www.hyline.com) and Lohmann (prior written permission required,
https://lohmann-breeders.com/legal/ and https://lohmann-breeders.com/terms/). **None is usable without the breeder’s
written permission, so no laying table is committed.** The other breeders and their terms are in
`../curves/README.md` (Licence status).
