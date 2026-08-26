-- Per-shop toggles for portal admin notification emails. Defaults keep the
-- current behaviour: every existing admin notification stays on.

ALTER TABLE "ShopSettings" ADD COLUMN "adminEmailNewRequest" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShopSettings" ADD COLUMN "adminEmailCustomerResponse" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShopSettings" ADD COLUMN "adminEmailPaymentAfterVoid" BOOLEAN NOT NULL DEFAULT true;
