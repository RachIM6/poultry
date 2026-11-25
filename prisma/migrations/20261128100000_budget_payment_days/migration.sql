-- SPEC-finance FN15, §9 "Budget cash need": the supplier payment delays a budget was saved with, in days after the
-- chicks' placement and after each day's feed. Null: the farm's own delay when shown (budgets saved before carry none).
ALTER TABLE "Budget" ADD COLUMN "chickPaymentDays" INTEGER;
ALTER TABLE "Budget" ADD COLUMN "feedPaymentDays" INTEGER;
