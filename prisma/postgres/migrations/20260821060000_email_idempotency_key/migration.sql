-- Deduplicates outbound email, and indexes the Shopify order lookup used by the
-- orders/paid webhook.
--
-- Separate from 20260820120000_init because the production database has already
-- applied init: editing that migration would change its checksum and make
-- `prisma migrate deploy` fail against the live database.
--
-- Existing rows keep a NULL key. PostgreSQL treats NULLs as distinct in a unique
-- index, so no backfill is needed and this cannot fail on historical data.

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_shop_idempotencyKey_key" ON "EmailMessage"("shop", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ShopifyOrderReference_shopifyOrderGid_idx" ON "ShopifyOrderReference"("shopifyOrderGid");
