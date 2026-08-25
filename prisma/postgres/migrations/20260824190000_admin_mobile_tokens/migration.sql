-- Device tokens for the iOS admin app. The plaintext token is never stored.

CREATE TABLE "AdminMobileToken" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminMobileToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminMobileToken_tokenHash_key" ON "AdminMobileToken"("tokenHash");
CREATE INDEX "AdminMobileToken_shop_revokedAt_idx" ON "AdminMobileToken"("shop", "revokedAt");
