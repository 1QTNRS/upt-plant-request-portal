-- Grower's Choice from existing Shopify stock: a second fulfilment route
-- alongside the exact plant.
--
-- Purely additive. `fulfillmentType` carries a non-null default, so every row
-- already in the database reads as the exact-plant route it was created under,
-- and every other column is nullable — an item nobody has linked store stock to
-- simply has none. Nothing here can fail on a database that already holds
-- requests, offers or draft orders.

-- AlterTable
ALTER TABLE "RequestItem" ADD COLUMN     "fulfillmentType" TEXT NOT NULL DEFAULT 'exact_plant',
ADD COLUMN     "linkedProductGid" TEXT,
ADD COLUMN     "linkedProductTitle" TEXT,
ADD COLUMN     "linkedProductHandle" TEXT,
ADD COLUMN     "linkedVariantGid" TEXT,
ADD COLUMN     "linkedVariantTitle" TEXT,
ADD COLUMN     "linkedVariantSku" TEXT,
ADD COLUMN     "linkedVariantPrice" DOUBLE PRECISION,
ADD COLUMN     "linkedVariantWeightLbs" DOUBLE PRECISION,
ADD COLUMN     "linkedInventoryQuantity" INTEGER,
ADD COLUMN     "linkedInventoryTracked" BOOLEAN,
ADD COLUMN     "linkedImageUrl" TEXT,
ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "fulfillmentIssue" TEXT;

-- AlterTable
ALTER TABLE "OfferItem" ADD COLUMN     "fulfillmentType" TEXT NOT NULL DEFAULT 'exact_plant',
ADD COLUMN     "linkedProductGid" TEXT,
ADD COLUMN     "linkedProductTitle" TEXT,
ADD COLUMN     "linkedProductHandle" TEXT,
ADD COLUMN     "linkedVariantGid" TEXT,
ADD COLUMN     "linkedVariantTitle" TEXT,
ADD COLUMN     "linkedVariantSku" TEXT,
ADD COLUMN     "linkedVariantWeightLbs" DOUBLE PRECISION,
ADD COLUMN     "linkedImageUrl" TEXT;

-- AlterTable
ALTER TABLE "ResponseItem" ADD COLUMN     "fulfillmentType" TEXT NOT NULL DEFAULT 'exact_plant',
ADD COLUMN     "linkedProductTitle" TEXT,
ADD COLUMN     "linkedVariantGid" TEXT,
ADD COLUMN     "linkedVariantTitle" TEXT,
ADD COLUMN     "linkedImageUrl" TEXT;

-- AlterTable
ALTER TABLE "DraftOrderReference" ADD COLUMN     "reserveInventoryUntil" TIMESTAMP(3);
