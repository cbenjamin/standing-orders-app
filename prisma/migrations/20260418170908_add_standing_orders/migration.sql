-- CreateTable
CREATE TABLE "StandingOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopifyCustomerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "deliveryDay" INTEGER NOT NULL,
    "closeDay" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StandingOrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "standingOrderId" INTEGER NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "price" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "StandingOrderItem_standingOrderId_fkey" FOREIGN KEY ("standingOrderId") REFERENCES "StandingOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DraftOrderRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "standingOrderId" INTEGER NOT NULL,
    "shopifyDraftOrderId" TEXT NOT NULL,
    "shopifyDraftOrderName" TEXT,
    "deliveryDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedOrderId" TEXT,
    CONSTRAINT "DraftOrderRecord_standingOrderId_fkey" FOREIGN KEY ("standingOrderId") REFERENCES "StandingOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DraftOrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "draftOrderRecordId" INTEGER NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "lineKey" TEXT,
    "minimumQuantity" INTEGER NOT NULL DEFAULT 0,
    "isStandingItem" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "DraftOrderItem_draftOrderRecordId_fkey" FOREIGN KEY ("draftOrderRecordId") REFERENCES "DraftOrderRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
