-- CreateIndex
CREATE INDEX "PlantRequest_shop_shopifyCustomerId_idx" ON "PlantRequest"("shop", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "EmailMessage_shop_templateKey_idx" ON "EmailMessage"("shop", "templateKey");
