-- Record when an admin dismisses an eligible plant from the EXACT PLANTS
-- review queue without creating a Shopify product.
--
-- Purely additive and nullable. Reverted code ignores the column; no
-- down-migration is needed. SQLite accepts ADD COLUMN without rebuilding
-- the table.

ALTER TABLE "RequestItem" ADD COLUMN "exactPlantDismissedAt" DATETIME;
