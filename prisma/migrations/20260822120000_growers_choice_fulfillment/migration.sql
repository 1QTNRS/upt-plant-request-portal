-- Grower's Choice from existing Shopify stock: a second fulfilment route
-- alongside the exact plant.
--
-- Purely additive. `fulfillmentType` carries a non-null default, so every row
-- already in the database reads as the exact-plant route it was created under,
-- and every other column is nullable — an item nobody has linked store stock to
-- simply has none. SQLite accepts ADD COLUMN for both shapes without rebuilding
-- the table, so this cannot fail on a database that already holds requests,
-- offers or draft orders.

-- AlterTable
ALTER TABLE "RequestItem" ADD COLUMN "fulfillmentType" TEXT NOT NULL DEFAULT 'exact_plant';
ALTER TABLE "RequestItem" ADD COLUMN "linkedProductGid" TEXT;
ALTER TABLE "RequestItem" ADD COLUMN "linkedProductTitle" TEXT;
ALTER TABLE "RequestItem" ADD COLUMN "linkedProductHandle" TEXT;
ALTER TABLE "RequestItem" ADD COLUMN "linkedVariantGid" TEXT;
ALTER TABLE "RequestItem" ADD COLUMN "linkedVariantTitle" TEXT;
ALTER TABLE "RequestItem" ADD COLUMN "linkedVariantSku" TEXT;
ALTER TABLE "RequestItem" ADD COLUMN "linkedVariantPrice" REAL;
ALTER TABLE "RequestItem" ADD COLUMN "linkedVariantWeightLbs" REAL;
ALTER TABLE "RequestItem" ADD COLUMN "linkedInventoryQuantity" INTEGER;
ALTER TABLE "RequestItem" ADD COLUMN "linkedInventoryTracked" BOOLEAN;
ALTER TABLE "RequestItem" ADD COLUMN "linkedImageUrl" TEXT;
ALTER TABLE "RequestItem" ADD COLUMN "linkedAt" DATETIME;
ALTER TABLE "RequestItem" ADD COLUMN "fulfillmentIssue" TEXT;

-- AlterTable
ALTER TABLE "OfferItem" ADD COLUMN "fulfillmentType" TEXT NOT NULL DEFAULT 'exact_plant';
ALTER TABLE "OfferItem" ADD COLUMN "linkedProductGid" TEXT;
ALTER TABLE "OfferItem" ADD COLUMN "linkedProductTitle" TEXT;
ALTER TABLE "OfferItem" ADD COLUMN "linkedProductHandle" TEXT;
ALTER TABLE "OfferItem" ADD COLUMN "linkedVariantGid" TEXT;
ALTER TABLE "OfferItem" ADD COLUMN "linkedVariantTitle" TEXT;
ALTER TABLE "OfferItem" ADD COLUMN "linkedVariantSku" TEXT;
ALTER TABLE "OfferItem" ADD COLUMN "linkedVariantWeightLbs" REAL;
ALTER TABLE "OfferItem" ADD COLUMN "linkedImageUrl" TEXT;

-- AlterTable
ALTER TABLE "ResponseItem" ADD COLUMN "fulfillmentType" TEXT NOT NULL DEFAULT 'exact_plant';
ALTER TABLE "ResponseItem" ADD COLUMN "linkedProductTitle" TEXT;
ALTER TABLE "ResponseItem" ADD COLUMN "linkedVariantGid" TEXT;
ALTER TABLE "ResponseItem" ADD COLUMN "linkedVariantTitle" TEXT;
ALTER TABLE "ResponseItem" ADD COLUMN "linkedImageUrl" TEXT;

-- AlterTable
ALTER TABLE "DraftOrderReference" ADD COLUMN "reserveInventoryUntil" DATETIME;
