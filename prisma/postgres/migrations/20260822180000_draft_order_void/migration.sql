-- Record when an expired unpaid invoice was made non-payable.
-- Purely additive and nullable so reverted code can ignore the columns.

ALTER TABLE "DraftOrderReference" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "DraftOrderReference" ADD COLUMN "voidStartedAt" TIMESTAMP(3);
ALTER TABLE "DraftOrderReference" ADD COLUMN "voidError" TEXT;
ALTER TABLE "DraftOrderReference" ADD COLUMN "voidAttempts" INTEGER NOT NULL DEFAULT 0;
