-- SPEC-finance §9 "Default cash box and bank account": the cash box or bank account that takes the 5141 / 5161 lines
-- naming none (sales, purchases, payments and wages paid "en espèces" or "par banque"). At most one per kind; none
-- marked, the first created of its kind. Lines posted before keep no account.
ALTER TABLE "TreasuryAccount" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "TreasuryAccount_one_default_per_kind" ON "TreasuryAccount"("organizationId", kind) WHERE "isDefault";
