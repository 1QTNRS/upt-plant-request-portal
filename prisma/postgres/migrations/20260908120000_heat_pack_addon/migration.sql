-- Heat Pack seasonal add-on settings and customer response fields.

ALTER TABLE "ShopSettings" ADD COLUMN "heatPackAddonEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackProductHandle" TEXT NOT NULL DEFAULT 'heat-pack-includes-foil-insulation';
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackVariantGid" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackLabel" TEXT NOT NULL DEFAULT 'Heat Pack (includes foil insulation)';

ALTER TABLE "CustomerResponse" ADD COLUMN "heatPackSelected" BOOLEAN;
ALTER TABLE "CustomerResponse" ADD COLUMN "heatPackPrice" DOUBLE PRECISION;
