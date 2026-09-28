-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN "smsNotifyOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerProfile" ADD COLUMN "smsNotifyPhone" TEXT;
ALTER TABLE "CustomerProfile" ADD COLUMN "smsNotifyOptInAt" TIMESTAMP(3);
