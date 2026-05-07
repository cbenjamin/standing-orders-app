import cron from "node-cron";
import prisma from "./db.server.js";
import { unauthenticated } from "./shopify.server.js";
import {
  createDraftOrderForStandingOrder,
  completeDraftOrderRecord,
} from "./services/draft-orders.server.js";
import { sendDraftOrderReminderEmail } from "./services/shopify-graphql.server.js";
import { logEvent } from "./services/events.server.js";

let started = false;

// Returns current date/time in America/New_York (handles DST automatically)
function getNowEST() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

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

export async function runDraftOrderLocker() {
  const nowEST = getNowEST();
  const todayDay = nowEST.getDay();
  const currentTime = `${String(nowEST.getHours()).padStart(2, "0")}:${String(nowEST.getMinutes()).padStart(2, "0")}`;

  const records = await prisma.draftOrderRecord.findMany({
    where: { status: "open", standingOrder: { closeDay: todayDay } },
    include: { standingOrder: true },
  });

  const due = records.filter((r) => currentTime >= (r.standingOrder.closeTime || "12:00"));
  console.log(`[cron] Locker: EST ${currentTime} on day ${todayDay} — ${due.length}/${records.length} orders past cutoff`);

  for (const record of due) {
    await prisma.draftOrderRecord.update({
      where: { id: record.id },
      data: { status: "locked" },
    });
    console.log(`[cron] Locked draft order record ${record.id} (cutoff was ${record.standingOrder.closeTime})`);
  }
}

function addOneHour(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const newH = (h + 1) % 24;
  return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function runDraftOrderCompleter() {
  const nowEST = getNowEST();
  const todayDay = nowEST.getDay();
  const currentTime = `${String(nowEST.getHours()).padStart(2, "0")}:${String(nowEST.getMinutes()).padStart(2, "0")}`;

  const records = await prisma.draftOrderRecord.findMany({
    where: {
      status: { in: ["open", "locked"] },
      standingOrder: { closeDay: todayDay },
    },
    include: { standingOrder: true },
  });

  const due = records.filter((r) => currentTime >= addOneHour(r.standingOrder.closeTime || "12:00"));
  console.log(`[cron] Completer: EST ${currentTime} on day ${todayDay} — ${due.length}/${records.length} orders past convert time`);

  if (!due.length) return;
  const admin = await getAdminClient();

  for (const record of due) {
    try {
      const orderId = await completeDraftOrderRecord(admin, record.id);
      console.log(`[cron] Completed ${record.shopifyDraftOrderName} → order ${orderId}`);
    } catch (err) {
      console.error(`[cron] Failed to complete record ${record.id}: ${err.message}`);
    }
  }
}

export async function runDraftOrderReminder() {
  const nowEST = getNowEST();
  const tomorrowDay = (nowEST.getDay() + 1) % 7;

  const records = await prisma.draftOrderRecord.findMany({
    where: {
      status: "open",
      reminderSentAt: null,
      standingOrder: {
        closeDay: tomorrowDay,
        sendReminder: true,
        status: "active",
      },
    },
    include: { standingOrder: true },
  });

  console.log(`[cron] Reminder: ${records.length} open draft orders to remind for tomorrow's cutoff (day ${tomorrowDay})`);
  if (!records.length) return;

  const admin = await getAdminClient();

  for (const record of records) {
    try {
      await sendDraftOrderReminderEmail(admin, record.shopifyDraftOrderId, {
        closeTime: record.standingOrder.closeTime || "12:00",
        deliveryDate: record.deliveryDate,
      });
      await prisma.draftOrderRecord.update({
        where: { id: record.id },
        data: { reminderSentAt: new Date() },
      });
      await logEvent(record.standingOrderId, record.id, "reminder_email_sent", {
        draftOrderName: record.shopifyDraftOrderName,
        deliveryDate: record.deliveryDate,
      });
      console.log(`[cron] Reminder sent for ${record.shopifyDraftOrderName} (delivery: ${record.deliveryDate})`);
    } catch (err) {
      console.error(`[cron] Reminder failed for record ${record.id}: ${err.message}`);
    }
  }
}

export function initCron() {
  if (started) return;
  started = true;

  const createSchedule = process.env.CRON_DRAFT_CREATE || "0 6 * * *";
  const lockSchedule = process.env.CRON_DRAFT_LOCK || "*/15 * * * *";
  const completeSchedule = process.env.CRON_DRAFT_COMPLETE || "*/15 * * * *";
  const reminderSchedule = process.env.CRON_DRAFT_REMINDER || "0 8 * * *";

  cron.schedule(createSchedule, () => {
    console.log("[cron] Running draft order creation job");
    runDraftOrderCreator().catch((err) =>
      console.error("[cron] Creator job failed:", err.message),
    );
  });

  cron.schedule(lockSchedule, () => {
    console.log("[cron] Running draft order locker job");
    runDraftOrderLocker().catch((err) =>
      console.error("[cron] Locker job failed:", err.message),
    );
  });

  cron.schedule(completeSchedule, () => {
    console.log("[cron] Running draft order completion job");
    runDraftOrderCompleter().catch((err) =>
      console.error("[cron] Completer job failed:", err.message),
    );
  });

  cron.schedule(reminderSchedule, () => {
    console.log("[cron] Running draft order reminder job");
    runDraftOrderReminder().catch((err) =>
      console.error("[cron] Reminder job failed:", err.message),
    );
  });

  console.log(`[cron] Scheduler started — create: ${createSchedule} | lock: ${lockSchedule} | complete: ${completeSchedule} | reminder: ${reminderSchedule}`);
}
