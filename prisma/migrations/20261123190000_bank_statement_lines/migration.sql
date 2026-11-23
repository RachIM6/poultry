-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "label" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_idx" ON "BankStatementLine"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_statementId_hash_key" ON "BankStatementLine"("statementId", "hash");

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

