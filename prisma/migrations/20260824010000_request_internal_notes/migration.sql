-- Admin-only notes on a plant request. Cascades with the request so a
-- customer redact cannot leave leftover comments behind.

CREATE TABLE "RequestInternalNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestInternalNote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RequestInternalNote_shop_requestId_createdAt_idx" ON "RequestInternalNote"("shop", "requestId", "createdAt");
