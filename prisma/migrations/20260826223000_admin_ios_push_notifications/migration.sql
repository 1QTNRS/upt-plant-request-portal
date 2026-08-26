-- Independent iOS push preferences, per-device Expo tokens, and an
-- idempotent admin push outbox. Email toggles are unchanged.

ALTER TABLE "ShopSettings" ADD COLUMN "adminPushNewRequest" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShopSettings" ADD COLUMN "adminPushItemStatusUpdate" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "AdminMobileToken" ADD COLUMN "expoPushToken" TEXT;

CREATE TABLE "AdminPushMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "requestId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    CONSTRAINT "AdminPushMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlantRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AdminPushMessage_shop_idempotencyKey_key" ON "AdminPushMessage"("shop", "idempotencyKey");
CREATE INDEX "AdminPushMessage_shop_status_idx" ON "AdminPushMessage"("shop", "status");
