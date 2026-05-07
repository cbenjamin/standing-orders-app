-- CreateTable
CREATE TABLE "StandingOrderEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "standingOrderId" INTEGER NOT NULL,
    "draftOrderRecordId" INTEGER,
    "eventType" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StandingOrderEvent_standingOrderId_fkey" FOREIGN KEY ("standingOrderId") REFERENCES "StandingOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StandingOrderEvent_draftOrderRecordId_fkey" FOREIGN KEY ("draftOrderRecordId") REFERENCES "DraftOrderRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
