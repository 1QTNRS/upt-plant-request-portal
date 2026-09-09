-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "heatPackDescription" TEXT NOT NULL DEFAULT 'We review the weather for every order before shipment. If a heat pack is not necessary, the cost will be refunded. If one is required but was not added, your order will be placed on hold and we will contact you.';
