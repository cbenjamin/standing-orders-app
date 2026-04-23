-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StandingOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopifyCustomerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "deliveryDay" INTEGER NOT NULL,
    "closeDay" INTEGER NOT NULL,
    "closeTime" TEXT NOT NULL DEFAULT '12:00',
    "sendReminder" BOOLEAN NOT NULL DEFAULT true,
    "sendCreationEmail" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_StandingOrder" ("closeDay", "closeTime", "createdAt", "customerEmail", "customerName", "deliveryDay", "endDate", "id", "name", "sendReminder", "shopifyCustomerId", "startDate", "status", "updatedAt") SELECT "closeDay", "closeTime", "createdAt", "customerEmail", "customerName", "deliveryDay", "endDate", "id", "name", "sendReminder", "shopifyCustomerId", "startDate", "status", "updatedAt" FROM "StandingOrder";
DROP TABLE "StandingOrder";
ALTER TABLE "new_StandingOrder" RENAME TO "StandingOrder";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
