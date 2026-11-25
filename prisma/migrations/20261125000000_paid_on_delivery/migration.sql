-- SPEC-finance §9 "Chicks paid on delivery": the cash box and the amount paid when the chicks were delivered, as the
-- phone sent them with the placement. Finance posts the payment; flock keeps the facts. Placements before carry none.
ALTER TABLE "Batch" ADD COLUMN "paidOnDeliveryCentimes" BIGINT;
ALTER TABLE "Batch" ADD COLUMN "paidOnDeliveryCashAccountId" UUID;
