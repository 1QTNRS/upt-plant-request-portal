-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "fedexRemovalWarning" TEXT NOT NULL,
    "fedexProductHandle" TEXT NOT NULL DEFAULT 'upgrade-to-fedex-priority-overnight-for-just-15-extra',
    "fedexVariantGid" TEXT,
    "fedexUpgradePrice" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "fedexUpgradeLabel" TEXT NOT NULL DEFAULT 'FedEx Priority Overnight Upgrade',
    "adminNotificationEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestNumberSequence" (
    "shop" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL,

    CONSTRAINT "RequestNumberSequence_pkey" PRIMARY KEY ("shop","year")
);

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "status" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstViewedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PlantRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "plantName" TEXT NOT NULL,
    "offeredName" TEXT NOT NULL,
    "budget" TEXT,
    "customerRequestNotes" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "availability" TEXT NOT NULL DEFAULT 'available',
    "unavailableReason" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weightLbs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "customerFacingNotes" TEXT NOT NULL DEFAULT '',
    "itemStatus" TEXT NOT NULL DEFAULT 'Requested',
    "purchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoReference" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "shopifyFileId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "expirationDays" INTEGER NOT NULL,
    "offerLink" TEXT NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferItem" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "plantName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "weightLbs" DOUBLE PRECISION NOT NULL,
    "customerFacingNotes" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "unavailableReason" TEXT,
    "photoUrlsJson" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "OfferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerResponse" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "requestNumber" TEXT NOT NULL,
    "offerExpiresAt" TIMESTAMP(3),
    "fedexUpgradeSelected" BOOLEAN NOT NULL DEFAULT true,
    "fedexUpgradePrice" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "snapshotJson" TEXT NOT NULL,

    CONSTRAINT "CustomerResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponseItem" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "plantName" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL,
    "customerFacingNotes" TEXT NOT NULL DEFAULT '',
    "photoUrlsJson" TEXT NOT NULL DEFAULT '[]',
    "unavailableReason" TEXT,

    CONSTRAINT "ResponseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftOrderReference" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "shopifyDraftOrderGid" TEXT,
    "invoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "lineItemsJson" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "DraftOrderReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOrderReference" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "shopifyOrderGid" TEXT NOT NULL,
    "orderNumber" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plantRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ShopifyOrderReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExactPlantListing" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "shopifyProductGid" TEXT,
    "shopifyProductHandle" TEXT,
    "title" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "weightLbs" DOUBLE PRECISION NOT NULL,
    "photoUrlsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExactPlantListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "requestId" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX "CustomerProfile_shop_shopifyCustomerId_idx" ON "CustomerProfile"("shop", "shopifyCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_shop_email_key" ON "CustomerProfile"("shop", "email");

-- CreateIndex
CREATE INDEX "PlantRequest_shop_status_idx" ON "PlantRequest"("shop", "status");

-- CreateIndex
CREATE INDEX "PlantRequest_shop_customerEmail_idx" ON "PlantRequest"("shop", "customerEmail");

-- CreateIndex
CREATE INDEX "PlantRequest_shop_submittedAt_idx" ON "PlantRequest"("shop", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlantRequest_shop_requestNumber_key" ON "PlantRequest"("shop", "requestNumber");

-- CreateIndex
CREATE INDEX "RequestItem_requestId_idx" ON "RequestItem"("requestId");

-- CreateIndex
CREATE INDEX "RequestItem_plantName_idx" ON "RequestItem"("plantName");

-- CreateIndex
CREATE INDEX "PhotoReference_itemId_sortOrder_idx" ON "PhotoReference"("itemId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_requestId_key" ON "Offer"("requestId");

-- CreateIndex
CREATE INDEX "OfferItem_offerId_idx" ON "OfferItem"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerResponse_requestId_key" ON "CustomerResponse"("requestId");

-- CreateIndex
CREATE INDEX "ResponseItem_responseId_idx" ON "ResponseItem"("responseId");

-- CreateIndex
CREATE INDEX "ResponseItem_choice_idx" ON "ResponseItem"("choice");

-- CreateIndex
CREATE UNIQUE INDEX "DraftOrderReference_requestId_key" ON "DraftOrderReference"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrderReference_requestId_key" ON "ShopifyOrderReference"("requestId");

-- CreateIndex
CREATE INDEX "StatusEvent_requestId_createdAt_idx" ON "StatusEvent"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExactPlantListing_requestItemId_key" ON "ExactPlantListing"("requestItemId");

-- CreateIndex
CREATE INDEX "ExactPlantListing_shop_status_idx" ON "ExactPlantListing"("shop", "status");

-- CreateIndex
CREATE INDEX "EmailMessage_shop_createdAt_idx" ON "EmailMessage"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_requestId_idx" ON "EmailMessage"("requestId");

-- AddForeignKey
ALTER TABLE "PlantRequest" ADD CONSTRAINT "PlantRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoReference" ADD CONSTRAINT "PhotoReference_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferItem" ADD CONSTRAINT "OfferItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferItem" ADD CONSTRAINT "OfferItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerResponse" ADD CONSTRAINT "CustomerResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponseItem" ADD CONSTRAINT "ResponseItem_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "CustomerResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponseItem" ADD CONSTRAINT "ResponseItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftOrderReference" ADD CONSTRAINT "DraftOrderReference_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrderReference" ADD CONSTRAINT "ShopifyOrderReference_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExactPlantListing" ADD CONSTRAINT "ExactPlantListing_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

