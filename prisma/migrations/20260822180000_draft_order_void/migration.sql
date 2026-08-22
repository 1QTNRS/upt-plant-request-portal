-- Record when an expired unpaid invoice was made non-payable.
--
-- Purely additive and nullable. Reverted code ignores these columns; no
-- down-migration is needed. SQLite accepts ADD COLUMN without rebuilding
-- the table, so this cannot fail on a database that already holds draft orders.

ALTER TABLE "DraftOrderReference" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "DraftOrderReference" ADD COLUMN "voidStartedAt" DATETIME;
ALTER TABLE "DraftOrderReference" ADD COLUMN "voidError" TEXT;
ALTER TABLE "DraftOrderReference" ADD COLUMN "voidAttempts" INTEGER NOT NULL DEFAULT 0;
