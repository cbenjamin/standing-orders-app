import prisma from "../db.server.js";
import {
  createDraftOrder,
  updateDraftOrder,
  createOrderFromDraft,
} from "./shopify-graphql.server.js";

/** Returns ISO date string (YYYY-MM-DD) for the next occurrence of targetDay (0=Sun…6=Sat), in EST */
export function nextWeekday(targetDay) {
  const nowEST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const diff = (targetDay - nowEST.getDay() + 7) % 7;
  nowEST.setDate(nowEST.getDate() + (diff === 0 ? 7 : diff));
  const y = nowEST.getFullYear();
  const m = String(nowEST.getMonth() + 1).padStart(2, "0");
  const d = String(nowEST.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function createDraftOrderForStandingOrder(admin, standingOrder) {
  const deliveryDate = nextWeekday(standingOrder.deliveryDay);

  // Don't create a draft if the delivery date falls after the standing order ends
  if (deliveryDate > standingOrder.endDate) return null;

  const existing = await prisma.draftOrderRecord.findFirst({
    where: { standingOrderId: standingOrder.id, deliveryDate },
  });
  if (existing) return null;

  const shopifyDraftOrder = await createDraftOrder(admin, {
    customerId: standingOrder.shopifyCustomerId,
    lineItems: standingOrder.items.map((item) => ({
      variantId: item.shopifyVariantId,
      quantity: item.quantity,
    })),
    note: `Standing Order: ${standingOrder.name} | Delivery: ${deliveryDate}`,
    tags: ["standing-order", `standing-order-id:${standingOrder.id}`],
  });

  await prisma.draftOrderRecord.create({
    data: {
      standingOrderId: standingOrder.id,
      shopifyDraftOrderId: shopifyDraftOrder.id,
      shopifyDraftOrderName: shopifyDraftOrder.name,
      deliveryDate,
      status: "open",
      items: {
        create: standingOrder.items.map((item) => ({
          shopifyVariantId: item.shopifyVariantId,
          minimumQuantity: item.quantity,
          isStandingItem: true,
        })),
      },
    },
  });

  return shopifyDraftOrder;
}

export async function applyCustomerDraftOrderUpdate(admin, draftOrderRecordId, lineItems) {
  const record = await prisma.draftOrderRecord.findUnique({
    where: { id: Number(draftOrderRecordId) },
    include: { items: true },
  });
  if (!record) throw new Error("Draft order not found");
  if (record.status !== "open") throw new Error("This draft order is no longer editable");

  // Build minimum quantity map for standing items
  const minimumMap = {};
  for (const item of record.items) {
    if (item.isStandingItem) minimumMap[item.shopifyVariantId] = item.minimumQuantity;
  }

  // Enforce: standing items cannot be removed or decreased below minimum
  for (const [variantId, minQty] of Object.entries(minimumMap)) {
    const submitted = lineItems.find((li) => li.variantId === variantId);
    if (!submitted) throw new Error(`Cannot remove standing order item (variant ${variantId})`);
    if (submitted.quantity < minQty) {
      throw new Error(`Quantity cannot be decreased below the standing order minimum of ${minQty}`);
    }
  }

  return updateDraftOrder(admin, {
    draftOrderId: record.shopifyDraftOrderId,
    lineItems,
  });
}

export async function completeDraftOrderRecord(admin, recordId) {
  const record = await prisma.draftOrderRecord.findUnique({
    where: { id: recordId },
    include: { standingOrder: true },
  });
  if (!record) throw new Error("Draft order record not found");

  const tags = ["standing-order", `standing-order-id:${record.standingOrderId}`];
  const note = `Standing Order: ${record.standingOrder.name} | Delivery: ${record.deliveryDate}`;

  const order = await createOrderFromDraft(admin, record.shopifyDraftOrderId, { tags, note });
  const orderId = order?.id || null;

  await prisma.draftOrderRecord.update({
    where: { id: recordId },
    data: { status: "completed", completedOrderId: orderId },
  });
  return orderId;
}
