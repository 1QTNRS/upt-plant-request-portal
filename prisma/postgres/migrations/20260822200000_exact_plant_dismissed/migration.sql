-- Record when an admin dismisses an eligible plant from the EXACT PLANTS
-- review queue without creating a Shopify product.
--
-- Purely additive and nullable. Reverted code ignores the column.
-- PostgreSQL ADD COLUMN on a nullable field does not rewrite the table.

ALTER TABLE "RequestItem" ADD COLUMN "exactPlantDismissedAt" TIMESTAMP(3);
