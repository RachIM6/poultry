# Strain standard curves (SPEC R1, open question OQ5)

One JSON file per published table, named `<strain>-<version>.json`, validated by `CurveFile` in
`src/modules/reference-data/schema.ts`:

```json
{
  "strainId": "ross-308",
  "source": "<document title>, <publisher>",
  "version": "<edition, e.g. 2022>",
  "sex": "mixed",
  "points": [{ "day": 0, "bodyWeightGrams": 0, "cumulativeFeedGrams": 0 }]
}
```

- Values are **as-hatched**, in integer grams, copied exactly from the breeder's document (Aviagen for Ross 308,
  Cobb-Vantress for Cobb 500). Days may skip: the app interpolates between published days and never extrapolates.
- No table is committed: OQ5 is decided, none of the breeders’ tables may be reused without written permission
  (Licence status below). Values must never be typed from memory. Once a file is added, run `pnpm db:seed`, then
  spot-check 5 values per strain against the document (T11 acceptance), including day 35.
- `sex` (SPEC-m3 R6) is `mixed` (default), `female` or `male`: turkey guides publish one table per sex. A guide
  published by week (pullets, turkeys) is imported as `day` = week × 7. Laying tables go in `../laying/`.

## Licence status (OQ5, checked 2026-11-24)

Every breeder table found is copyrighted and published without a licence for reuse in an app. **None is usable without
the breeder’s written permission, so no curve value is committed.** The import format, seed and lookup stay ready;
a table is added only with that permission on file (record it in the file’s `source`).

| Breeder | Document | Terms | Status |
|---|---|---|---|
| Aviagen (Ross 308, Arbor Acres) | Ross 308/308 FF Broiler Performance Objectives 2022 (0822-AVNR-157); Arbor Acres Plus / Plus S Broiler Performance Objectives 2022 (0822-AVNAA-089), from https://aviagen.com/en/brands/ross/management-resources and https://aviagen.com/en/brands/arbor-acres/management-resources | Legal statements, https://aviagen.com/en/legal-statements-and-disclaimers: “None of this material may be used for commercial or public use”. Aviagen Group Terms of Service 2024, https://aviagen.com/assets/Privacy-Policy/2024/Aviagen_Group_Terms_of_Service_2024_EN.pdf: no reproduction and no third-party apps without prior written consent | Written permission required |
| Hubbard | — | Same Aviagen Group Terms of Service 2024, https://www.hubbardbreeders.com/wp-content/uploads/2026/09/aviagen-group-terms-of-service-2024-en.pdf; https://www.hubbardbreeders.com/hubbard-premium/general-conditions-of-use | Written permission required |
| Aviagen Turkeys | — | Not verified (https://www.aviagenturkeys.com) | Unknown: treat as Aviagen Group, permission required |
| Cobb-Vantress (Cobb 500) | Cobb500 Broiler Performance & Nutrition Supplement 2022 (L-054-01-22), https://www.cobbgenetics.com/assets/Cobb-Files/2022-Cobb500-Broiler-Performance-Nutrition-Supplement.pdf | https://www.cobbgenetics.com/legal: “All rights reserved. Reproduction strictly prohibited.” Tyson Foods terms of use, https://www.tysonfoods.com/legal/terms-of-use | Written permission required |
| Hy-Line | Hy-Line Brown Commercial Layers Performance Standards Guide, https://www.hyline.com | © Hy-Line International, no licence given; the guide publishes ranges | Written permission required |
| Lohmann | — | https://lohmann-breeders.com/legal/ and https://lohmann-breeders.com/terms/: content may not be used in any other way without prior written permission | Written permission required |
