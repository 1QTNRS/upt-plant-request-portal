-- Which admin notification emails this shop wants. Defaults stay on.

ALTER TABLE "ShopSettings" ADD COLUMN "adminEmailNewRequest" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShopSettings" ADD COLUMN "adminEmailCustomerResponse" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShopSettings" ADD COLUMN "adminEmailPaymentAfterVoid" BOOLEAN NOT NULL DEFAULT true;
