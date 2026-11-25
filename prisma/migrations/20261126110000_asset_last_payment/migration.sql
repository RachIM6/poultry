-- SPEC-finance FC1, FQ23 (PCA pp. 77, 107): an asset bought on credit is owed on 1486 when its last payment day is more
-- than 12 months after its acquisition, else on 4481. Null: no term typed (4481, as every asset recorded before).
ALTER TABLE "FixedAsset" ADD COLUMN "lastPaymentOn" DATE;
