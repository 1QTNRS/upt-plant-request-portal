-- Customer Yes/No for an existing order, and an optional shipping fee
-- frozen onto the offer for the later draft order.

ALTER TABLE "PlantRequest" ADD COLUMN "hasExistingOrder" BOOLEAN;
ALTER TABLE "Offer" ADD COLUMN "shippingFeeOverride" DOUBLE PRECISION;
