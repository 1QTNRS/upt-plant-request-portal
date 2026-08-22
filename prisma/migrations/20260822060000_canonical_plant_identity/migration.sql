-- Canonical plant identity. Every column added to an existing table is
-- nullable, so the migration cannot fail on historical rows: existing
-- RequestItem rows keep canonicalPlantId NULL and the resolver's backfill sweep
-- claims them the next time the shop's analytics or request pages are loaded.
--
-- SQLite would ordinarily need the whole table rebuilding to gain a foreign key,
-- but ADD COLUMN accepts a REFERENCES clause when the default is NULL, so the
-- rows are left where they are rather than copied through a temporary table.
ALTER TABLE "RequestItem" ADD COLUMN "canonicalPlantId" TEXT REFERENCES "CanonicalPlant" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CanonicalPlant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlantNameAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "canonicalPlantId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'deterministic',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlantNameAlias_canonicalPlantId_fkey" FOREIGN KEY ("canonicalPlantId") REFERENCES "CanonicalPlant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlantIdentitySuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "suggestedCanonicalPlantId" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'deterministic',
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlantIdentitySuggestion_suggestedCanonicalPlantId_fkey" FOREIGN KEY ("suggestedCanonicalPlantId") REFERENCES "CanonicalPlant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CanonicalPlant_shop_displayName_idx" ON "CanonicalPlant"("shop", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalPlant_shop_canonicalKey_key" ON "CanonicalPlant"("shop", "canonicalKey");

-- CreateIndex
CREATE INDEX "PlantNameAlias_canonicalPlantId_idx" ON "PlantNameAlias"("canonicalPlantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlantNameAlias_shop_aliasKey_key" ON "PlantNameAlias"("shop", "aliasKey");

-- CreateIndex
CREATE INDEX "PlantIdentitySuggestion_shop_status_idx" ON "PlantIdentitySuggestion"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlantIdentitySuggestion_shop_aliasKey_suggestedCanonicalPlantId_key" ON "PlantIdentitySuggestion"("shop", "aliasKey", "suggestedCanonicalPlantId");

-- CreateIndex
CREATE INDEX "RequestItem_canonicalPlantId_idx" ON "RequestItem"("canonicalPlantId");
