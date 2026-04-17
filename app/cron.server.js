import cron from "node-cron";
import prisma from "./db.server.js";
import { unauthenticated } from "./shopify.server.js";
import {
  createDraftOrderForStandingOrder,
  completeDraftOrderRecord,
} from "./services/draft-orders.server.js";

let started = false;

async function getAdminClient() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  if (!shop) throw new Error("SHOPIFY_STORE_DOMAIN is not set");
  const { admin } = await unauthenticated.admin(shop);
  return admin;
}

export async function runDraftOrderCreator() {
  const today = new Date().toISOString().slice(0, 10);
  const orders = await prisma.standingOrder.findMany({
    where: {
      status: "active",
      startDate: { lte: today },
      endDate: { gte: today },
    },
    include: { items: true },
  });

  console.log(`[cron] Creating draft orders for ${orders.length} active standing orders`);
  const admin = await getAdminClient();

  for (const order of orders) {
    try {
      const result = await createDraftOrderForStandingOrder(admin, order);
      if (result) {
        console.log(`[cron] Created ${result.name} for standing order "${order.name}"`);
      } else {
        console.log(`[cron] Draft already exists this week for "${order.name}"`);
      }
    } catch (err) {
      console.error(`[cron] Failed for "${order.name}": ${err.message}`);
    }
  }
}

export async function runDraftOrderCompleter() {
  const today = new Date().getDay();
  const dueRecords = await prisma.draftOrderRecord.findMany({
    where: {
      status: "open",
      standingOrder: { closeDay: today },
    },
    include: { standingOrder: true },
  });

  console.log(`[cron] Completing ${dueRecords.length} draft orders due today`);
  const admin = await getAdminClient();

  for (const record of dueRecords) {
    try {
      const orderId = await completeDraftOrderRecord(admin, record.id);
      console.log(`[cron] Completed ${record.shopifyDraftOrderName} → order ${orderId}`);
    } catch (err) {
      console.error(`[cron] Failed to complete record ${record.id}: ${err.message}`);
    }
  }
}

export function initCron() {
  if (started) return;
  started = true;

  const createSchedule = process.env.CRON_DRAFT_CREATE || "0 6 * * *";
  const completeSchedule = process.env.CRON_DRAFT_COMPLETE || "0 21 * * *";

  cron.schedule(createSchedule, () => {
    console.log("[cron] Running draft order creation job");
    runDraftOrderCreator().catch((err) =>
      console.error("[cron] Creator job failed:", err.message),
    );
  });

  cron.schedule(completeSchedule, () => {
    console.log("[cron] Running draft order completion job");
    runDraftOrderCompleter().catch((err) =>
      console.error("[cron] Completer job failed:", err.message),
    );
  });

  console.log(`[cron] Scheduler started — create: ${createSchedule} | complete: ${completeSchedule}`);
}
