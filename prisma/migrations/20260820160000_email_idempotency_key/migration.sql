-- Deduplicates outbound email. Existing rows keep a NULL key: both SQLite and
-- PostgreSQL treat NULLs as distinct in a unique index, so no backfill is
-- needed and the migration cannot fail on historical data.
ALTER TABLE "EmailMessage" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "EmailMessage_shop_idempotencyKey_key" ON "EmailMessage"("shop", "idempotencyKey");

CREATE INDEX "ShopifyOrderReference_shopifyOrderGid_idx" ON "ShopifyOrderReference"("shopifyOrderGid");
