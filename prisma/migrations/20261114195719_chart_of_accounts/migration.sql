-- CreateTable
CREATE TABLE "LedgerAccount" (
    "chart" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentNumber" TEXT,
    "fallback" TEXT,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("chart","number")
);
