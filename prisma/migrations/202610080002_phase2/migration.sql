ALTER TABLE "Sale" ADD COLUMN "cancelledAt" TIMESTAMP(3);
UPDATE "Sale" SET "cancelledAt" = "createdAt" WHERE "status" = 'CANCELLED';
CREATE TABLE "ForecastConfig" (
 "branchId" TEXT NOT NULL PRIMARY KEY,
 "basis" TEXT NOT NULL DEFAULT 'AUTO',
 "conservativePct" DECIMAL(7,2) NOT NULL DEFAULT 85,
 "expectedPct" DECIMAL(7,2) NOT NULL DEFAULT 100,
 "optimisticPct" DECIMAL(7,2) NOT NULL DEFAULT 115,
 "futureCostPct" DECIMAL(7,2) NOT NULL DEFAULT 100,
 "extraExpense" DECIMAL(14,2) NOT NULL DEFAULT 0,
 "revenueTarget" DECIMAL(14,2) NOT NULL DEFAULT 0,
 "profitTarget" DECIMAL(14,2) NOT NULL DEFAULT 0,
 "recoveryMonthlyCash" DECIMAL(14,2) NOT NULL DEFAULT 0,
 "cashReviewedThrough" TEXT NOT NULL DEFAULT '',
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ForecastConfig_branchId_fkey" FOREIGN KEY("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "ExpenseRevision" (
 "id" SERIAL NOT NULL PRIMARY KEY,
 "expenseId" TEXT NOT NULL,
 "effectiveMonth" TEXT NOT NULL,
 "category" TEXT NOT NULL,
 "description" TEXT NOT NULL,
 "amount" DECIMAL(14,2) NOT NULL,
 "date" TIMESTAMP(3) NOT NULL,
 "frequency" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ExpenseRevision_expenseId_fkey" FOREIGN KEY("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ExpenseRevision_expenseId_effectiveMonth_idx" ON "ExpenseRevision"("expenseId","effectiveMonth");
INSERT INTO "ExpenseRevision" ("expenseId","effectiveMonth","category","description","amount","date","frequency","kind","active") SELECT "id",to_char("date" + interval '4 hours','YYYY-MM'),"category","description","amount","date","frequency","kind","active" FROM "Expense";
CREATE TABLE "Investment" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "requestKey" TEXT NOT NULL UNIQUE,
 "branchId" TEXT NOT NULL,
 "category" TEXT NOT NULL,
 "description" TEXT NOT NULL,
 "amount" DECIMAL(14,2) NOT NULL,
 "date" TIMESTAMP(3) NOT NULL,
 "kind" TEXT NOT NULL DEFAULT 'CAPITAL',
 "sample" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Investment_branchId_fkey" FOREIGN KEY("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CashMovement" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "requestKey" TEXT NOT NULL UNIQUE,
 "branchId" TEXT NOT NULL,
 "investmentId" TEXT,
 "expenseId" TEXT,
 "amount" DECIMAL(14,2) NOT NULL,
 "date" TIMESTAMP(3) NOT NULL,
 "direction" TEXT NOT NULL,
 "category" TEXT NOT NULL,
 "description" TEXT NOT NULL,
 "voidedAt" TIMESTAMP(3),
 "sample" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CashMovement_branchId_fkey" FOREIGN KEY("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CashMovement_investmentId_fkey" FOREIGN KEY("investmentId") REFERENCES "Investment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CashMovement_expenseId_fkey" FOREIGN KEY("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CashMovement_branchId_date_idx" ON "CashMovement"("branchId","date");
CREATE TABLE "PeriodClose" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "branchId" TEXT NOT NULL,
 "month" TEXT NOT NULL,
 "snapshot" JSONB NOT NULL,
 "closedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PeriodClose_branchId_fkey" FOREIGN KEY("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PeriodClose_branchId_month_key" ON "PeriodClose"("branchId","month");
