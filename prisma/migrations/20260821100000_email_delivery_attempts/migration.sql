-- Makes an undelivered message recoverable. `attempts` bounds the hourly
-- redelivery sweep so an address Resend will never accept is not retried
-- forever; existing rows start at 0, which is correct for a message that was
-- queued and never delivered.
ALTER TABLE "EmailMessage" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailMessage" ADD COLUMN "providerMessageId" TEXT;

-- The sweep selects by (shop, status).
CREATE INDEX "EmailMessage_shop_status_idx" ON "EmailMessage"("shop", "status");
