-- SPEC-finance FN9, FC6: the VAT of a placement's chicks or point-of-lay hens, on top of their price. Placements recorded
-- before carry none.
ALTER TABLE "Batch" ADD COLUMN "chickVatCentimes" BIGINT;
