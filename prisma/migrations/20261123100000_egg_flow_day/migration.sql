-- Discards and draws get the farm day they happened on (the phone's day, the sale's day), so the stock on a day no
-- longer depends on when the server received them. Existing rows: the farm day (Africa/Casablanca) they were received.

-- AlterTable
ALTER TABLE "EggDiscard" ADD COLUMN "day" DATE;
UPDATE "EggDiscard" SET "day" = ("createdAt" AT TIME ZONE 'Africa/Casablanca')::date;
ALTER TABLE "EggDiscard" ALTER COLUMN "day" SET NOT NULL;

-- AlterTable
ALTER TABLE "EggDraw" ADD COLUMN "day" DATE;
UPDATE "EggDraw" SET "day" = ("createdAt" AT TIME ZONE 'Africa/Casablanca')::date;
ALTER TABLE "EggDraw" ALTER COLUMN "day" SET NOT NULL;
