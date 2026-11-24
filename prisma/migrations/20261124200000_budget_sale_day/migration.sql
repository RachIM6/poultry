-- SPEC-finance FN15, §9 "Budget cash need": a budget not copied from a batch keeps its planned sale day (days after
-- placement), so its weekly cash need can be shown once saved. Budgets saved before carry none.
ALTER TABLE "Budget" ADD COLUMN "saleDay" INTEGER;
