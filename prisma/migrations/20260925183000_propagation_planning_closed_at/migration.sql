-- AlterTable
ALTER TABLE "PropagationPlanningState" ADD COLUMN "closedAt" DATETIME;

-- CreateIndex
CREATE INDEX "PropagationPlanningState_shop_closedAt_idx" ON "PropagationPlanningState"("shop", "closedAt");
