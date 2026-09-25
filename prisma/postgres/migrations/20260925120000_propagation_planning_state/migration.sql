-- CreateTable
CREATE TABLE "PropagationPlanningState" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "propNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropagationPlanningState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropagationPlanningState_shop_completedAt_idx" ON "PropagationPlanningState"("shop", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PropagationPlanningState_shop_groupKey_key" ON "PropagationPlanningState"("shop", "groupKey");
