-- AlterTable
ALTER TABLE "PropagationPlanningState" ADD COLUMN "closedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PropagationPlanningState_shop_closedAt_idx" ON "PropagationPlanningState"("shop", "closedAt");
