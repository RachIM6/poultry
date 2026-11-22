-- CreateTable
CREATE TABLE "Loan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "lender" TEXT NOT NULL,
    "treasuryId" UUID NOT NULL,
    "principalCentimes" BIGINT NOT NULL,
    "disbursedOn" DATE,
    "rate" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL,
    "installments" INTEGER NOT NULL,
    "deferral" INTEGER NOT NULL DEFAULT 0,
    "firstDueOn" DATE NOT NULL,
    "confirmedAt" TIMESTAMPTZ,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanInstallment" (
    "loanId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "organizationId" UUID NOT NULL,
    "dueOn" DATE NOT NULL,
    "capitalCentimes" BIGINT NOT NULL,
    "interestCentimes" BIGINT NOT NULL,
    "paidOn" DATE,
    "remindedAt" TIMESTAMPTZ,

    CONSTRAINT "LoanInstallment_pkey" PRIMARY KEY ("loanId","number")
);

-- CreateIndex
CREATE INDEX "Loan_organizationId_idx" ON "Loan"("organizationId");

-- CreateIndex
CREATE INDEX "LoanInstallment_organizationId_idx" ON "LoanInstallment"("organizationId");

-- CreateIndex
CREATE INDEX "LoanInstallment_dueOn_idx" ON "LoanInstallment"("dueOn");

-- AddForeignKey
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
