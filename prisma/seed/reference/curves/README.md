# Strain standard curves (SPEC R1, open question OQ5)

One JSON file per published table, named `<strain>-<version>.json`, validated by `CurveFile` in
`src/modules/reference-data/schema.ts`:

```json
{
  "strainId": "ross-308",
  "source": "<document title>, <publisher>",
  "version": "<edition, e.g. 2022>",
  "points": [{ "day": 0, "bodyWeightGrams": 0, "cumulativeFeedGrams": 0 }]
}
```

- Values are **as-hatched**, in integer grams, copied exactly from the breeder's document (Aviagen for Ross 308,
  Cobb-Vantress for Cobb 500). Days may skip: the app interpolates between published days and never extrapolates.
- No table is committed yet. OQ5 (source and licence of these documents) is open, and values must never be typed from
  memory. Once a file is added, run `pnpm db:seed`, then spot-check 5 values per strain against the document
  (T11 acceptance), including day 35.
