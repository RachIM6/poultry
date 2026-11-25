-- SPEC-finance FC2, FQ17 (PCA p. 75): a subsidy on land is released over the years the contract makes it inalienable,
-- else a tenth a year. Null: no clause. Additive; the subsidies recorded before finance no land (it was refused).
ALTER TABLE "Subsidy" ADD COLUMN "inalienableYears" INTEGER;
