-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackAddonEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackProductHandle" TEXT NOT NULL DEFAULT 'heat-pack-includes-foil-insulation';
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackVariantGid" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackPrice" REAL NOT NULL DEFAULT 0;
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackLabel" TEXT NOT NULL DEFAULT 'Heat Pack (includes foil insulation)';

-- AlterTable
ALTER TABLE "CustomerResponse" ADD COLUMN "heatPackSelected" BOOLEAN;
ALTER TABLE "CustomerResponse" ADD COLUMN "heatPackPrice" REAL;
