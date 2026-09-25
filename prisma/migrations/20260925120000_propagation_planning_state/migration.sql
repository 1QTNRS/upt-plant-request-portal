-- CreateTable
CREATE TABLE "PropagationPlanningState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "completedAt" DATETIME,
    "propNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PropagationPlanningState_shop_completedAt_idx" ON "PropagationPlanningState"("shop", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PropagationPlanningState_shop_groupKey_key" ON "PropagationPlanningState"("shop", "groupKey");
