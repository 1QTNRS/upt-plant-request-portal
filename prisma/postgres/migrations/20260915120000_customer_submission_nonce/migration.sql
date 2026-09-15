-- AlterTable
ALTER TABLE "PlantRequest" ADD COLUMN "submissionNonce" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PlantRequest_shop_submissionNonce_key" ON "PlantRequest"("shop", "submissionNonce");
