-- Optional IANA timezone captured from the customer's browser.
-- Additive and nullable. Reverted code ignores the column.

ALTER TABLE "CustomerProfile" ADD COLUMN "timeZone" TEXT;
