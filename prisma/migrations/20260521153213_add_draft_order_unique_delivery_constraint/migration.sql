-- Remove duplicate DraftOrderRecords, keeping the lowest id per
-- (standingOrderId, deliveryDate) pair. Duplicates were created when
-- the cron scheduler ran on multiple PM2 instances simultaneously.
DELETE FROM "DraftOrderRecord"
WHERE id NOT IN (
  SELECT MIN(id)
  FROM "DraftOrderRecord"
  GROUP BY standingOrderId, deliveryDate
);

-- Enforce uniqueness at the database level so concurrent scheduler
-- runs can no longer create duplicates for the same standing order
-- and delivery date.
CREATE UNIQUE INDEX "DraftOrderRecord_standingOrderId_deliveryDate_key"
ON "DraftOrderRecord"("standingOrderId", "deliveryDate");
