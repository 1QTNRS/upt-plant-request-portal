-- Device tokens for the iOS admin app. The plaintext token is never stored.

CREATE TABLE "AdminMobileToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);

CREATE UNIQUE INDEX "AdminMobileToken_tokenHash_key" ON "AdminMobileToken"("tokenHash");
CREATE INDEX "AdminMobileToken_shop_revokedAt_idx" ON "AdminMobileToken"("shop", "revokedAt");
