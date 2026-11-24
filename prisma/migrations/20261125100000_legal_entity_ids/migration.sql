-- F-Profile (tasks/plan-ui.md U14): the legal entity's Moroccan registration numbers, all optional, as the owner types
-- them: ICE (15 digits), identifiant fiscal, registre de commerce number and its court, CNSS affiliation number.
ALTER TABLE "LegalEntity" ADD COLUMN "ice" TEXT;
ALTER TABLE "LegalEntity" ADD COLUMN "fiscalId" TEXT;
ALTER TABLE "LegalEntity" ADD COLUMN "rcNumber" TEXT;
ALTER TABLE "LegalEntity" ADD COLUMN "rcCourt" TEXT;
ALTER TABLE "LegalEntity" ADD COLUMN "cnssNumber" TEXT;
