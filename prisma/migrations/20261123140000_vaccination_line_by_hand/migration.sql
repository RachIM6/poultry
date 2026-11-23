-- SPEC-m5 PA4: a line of a batch's plan added by hand comes from no protocol.
ALTER TABLE "Vaccination" ALTER COLUMN "protocolId" DROP NOT NULL;
