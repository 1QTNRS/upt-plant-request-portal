-- CreateTable
CREATE TABLE "ExactPlantListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "shopifyProductGid" TEXT,
    "shopifyProductHandle" TEXT,
    "title" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "weightLbs" REAL NOT NULL,
    "photoUrlsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExactPlantListing_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExactPlantListing_requestItemId_key" ON "ExactPlantListing"("requestItemId");

-- CreateIndex
CREATE INDEX "ExactPlantListing_shop_status_idx" ON "ExactPlantListing"("shop", "status");
