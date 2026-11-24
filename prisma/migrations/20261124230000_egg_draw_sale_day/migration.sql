-- 20261123100000_egg_flow_day backfilled each draw's day from when the server received it, but the column is the
-- sale's farm day: a sale recorded offline and synced on a later day had its draws on the wrong day. Take the sale's.
UPDATE "EggDraw" d
SET "day" = s."day"
FROM "Sale" s
WHERE s."id" = d."saleId" AND s."organizationId" = d."organizationId" AND d."day" <> s."day";
