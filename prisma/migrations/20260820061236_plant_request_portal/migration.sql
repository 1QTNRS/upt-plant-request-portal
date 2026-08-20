-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "fedexRemovalWarning" TEXT NOT NULL,
    "fedexProductHandle" TEXT NOT NULL DEFAULT 'upgrade-to-fedex-priority-overnight-for-just-15-extra',
    "fedexVariantGid" TEXT,
    "fedexUpgradePrice" REAL NOT NULL DEFAULT 15,
    "fedexUpgradeLabel" TEXT NOT NULL DEFAULT 'FedEx Priority Overnight Upgrade',
    "adminNotificationEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RequestNumberSequence" (
    "shop" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL,

    PRIMARY KEY ("shop", "year")
);

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlantRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "status" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstViewedAt" DATETIME,
    "closedAt" DATETIME,
    "expiredAt" DATETIME,
    "paidAt" DATETIME,
    CONSTRAINT "PlantRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RequestItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "plantName" TEXT NOT NULL,
    "offeredName" TEXT NOT NULL,
    "budget" TEXT,
    "customerRequestNotes" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "availability" TEXT NOT NULL DEFAULT 'available',
    "unavailableReason" TEXT,
    "price" REAL NOT NULL DEFAULT 0,
    "weightLbs" REAL NOT NULL DEFAULT 0,
    "customerFacingNotes" TEXT NOT NULL DEFAULT '',
    "itemStatus" TEXT NOT NULL DEFAULT 'Requested',
    "purchasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PhotoReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "shopifyFileId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhotoReference_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RequestItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "expirationDays" INTEGER NOT NULL,
    "offerLink" TEXT NOT NULL,
    CONSTRAINT "Offer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OfferItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "plantName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "weightLbs" REAL NOT NULL,
    "customerFacingNotes" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "unavailableReason" TEXT,
    "photoUrlsJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "OfferItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OfferItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "respondedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "requestNumber" TEXT NOT NULL,
    "offerExpiresAt" DATETIME,
    "fedexUpgradeSelected" BOOLEAN NOT NULL DEFAULT true,
    "fedexUpgradePrice" REAL NOT NULL DEFAULT 15,
    "snapshotJson" TEXT NOT NULL,
    CONSTRAINT "CustomerResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResponseItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "plantName" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "customerFacingNotes" TEXT NOT NULL DEFAULT '',
    "photoUrlsJson" TEXT NOT NULL DEFAULT '[]',
    "unavailableReason" TEXT,
    CONSTRAINT "ResponseItem_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "CustomerResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResponseItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DraftOrderReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "shopifyDraftOrderGid" TEXT,
    "invoiceUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    "lineItemsJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "DraftOrderReference_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShopifyOrderReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "shopifyOrderGid" TEXT NOT NULL,
    "orderNumber" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plantRevenue" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "ShopifyOrderReference_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatusEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "requestId" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "EmailMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
CREATE INDEX "EmailMessage_shop_createdAt_idx" ON "EmailMessage"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_requestId_idx" ON "EmailMessage"("requestId");
