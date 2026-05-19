import prisma from "../db.server.js";
import {
  createDraftOrder,
  updateDraftOrder,
  createOrderFromDraft,
  sendDraftOrderCreationEmail,
  getDraftOrderDetails,
  getVariantPrices,
} from "./shopify-graphql.server.js";
import { logEvent } from "./events.server.js";

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

  // Fetch current variant prices so we can apply a line-item discount
  // to reach the custom standing order price (Shopify ignores originalUnitPrice
  // when variantId is provided, so appliedDiscount is the reliable override)
  const variantIds = standingOrder.items.map((i) => i.shopifyVariantId);
  const variantPrices = await getVariantPrices(admin, variantIds);

  const lineItems = standingOrder.items.map((item) => {
    const customPrice = parseFloat(item.price);
    const variantPrice = parseFloat(variantPrices[item.shopifyVariantId] ?? item.price);
    const li = { variantId: item.shopifyVariantId, quantity: item.quantity };

    if (!isNaN(customPrice) && !isNaN(variantPrice) && customPrice < variantPrice) {
      const discountAmount = parseFloat((variantPrice - customPrice).toFixed(2));
      li.appliedDiscount = {
        valueType: "FIXED_AMOUNT",
        value: discountAmount,
        title: "Standing order price",
      };
      console.log(`[draft-orders] Custom price $${customPrice} for variant ${item.shopifyVariantId} (listed $${variantPrice}) — discount $${discountAmount}`);
    }
    return li;
  });

  const shopifyDraftOrder = await createDraftOrder(admin, {
    customerId: standingOrder.shopifyCustomerId,
    lineItems,
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

  // Fetch the newly created record id for event logging
  const newRecord = await prisma.draftOrderRecord.findFirst({
    where: { standingOrderId: standingOrder.id, deliveryDate },
    orderBy: { createdAt: "desc" },
  });

  if (standingOrder.sendCreationEmail) {
    try {
      await sendDraftOrderCreationEmail(admin, shopifyDraftOrder.id, {
        closeTime: standingOrder.closeTime || "12:00",
        closeDay: standingOrder.closeDay,
        deliveryDate,
      });
      await logEvent(standingOrder.id, newRecord?.id ?? null, "creation_email_sent", {
        draftOrderName: shopifyDraftOrder.name,
        deliveryDate,
      });
    } catch (err) {
      console.error(`[draft-orders] Creation email failed for "${standingOrder.name}": ${err.message}`);
    }
  }

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

  // Fetch current draft to re-apply any standing order price discounts
  const draft = await getDraftOrderDetails(admin, record.shopifyDraftOrderId);
  const priceMap = {};
  for (const { node } of draft.lineItems.edges) {
    if (node.variant?.id) {
      priceMap[node.variant.id] = {
        regularPrice: parseFloat(node.originalUnitPrice || 0),
        discountedPrice: parseFloat(node.discountedUnitPrice || node.originalUnitPrice || 0),
      };
    }
  }

  const lineItemsWithPrices = lineItems.map((li) => {
    const prices = priceMap[li.variantId];
    const item = { variantId: li.variantId, quantity: li.quantity };
    if (prices && prices.discountedPrice < prices.regularPrice) {
      const discountAmount = parseFloat((prices.regularPrice - prices.discountedPrice).toFixed(2));
      item.appliedDiscount = {
        valueType: "FIXED_AMOUNT",
        value: discountAmount,
        title: "Standing order price",
      };
    }
    return item;
  });

  await updateDraftOrder(admin, {
    draftOrderId: record.shopifyDraftOrderId,
    lineItems: lineItemsWithPrices,
  });

  // Compute additional revenue above the standing minimums
  let additionalRevenue = 0;
  for (const li of lineItems) {
    const prices = priceMap[li.variantId];
    const effectivePrice = prices?.discountedPrice ?? prices?.regularPrice ?? 0;
    const standingItem = record.items.find((i) => i.shopifyVariantId === li.variantId && i.isStandingItem);
    const baseQty = standingItem ? standingItem.minimumQuantity : 0;
    const extraQty = li.quantity - baseQty;
    if (extraQty > 0) additionalRevenue += extraQty * effectivePrice;
  }

  await logEvent(record.standingOrderId, record.id, "customer_updated", {
    additionalRevenue: parseFloat(additionalRevenue.toFixed(2)),
    lineItems: lineItems.map((li) => ({
      variantId: li.variantId,
      quantity: li.quantity,
    })),
  });
}

/**
 * Re-submits the current line items on a draft order so Shopify re-validates
 * prices. Required when a draft was manually edited and Shopify flags its
 * custom prices as stale before draftOrderComplete can proceed.
 */
async function refreshDraftOrderPrices(admin, draftOrderId) {
  const draft = await getDraftOrderDetails(admin, draftOrderId);

  const lineItems = draft.lineItems.edges.map(({ node }) => {
    if (node.variant?.id) {
      // Variant-based line item — re-apply standing-order discount if present
      const original = parseFloat(node.originalUnitPrice || 0);
      const discounted = parseFloat(node.discountedUnitPrice ?? node.originalUnitPrice ?? 0);
      const item = { variantId: node.variant.id, quantity: node.quantity };
      if (discounted < original) {
        item.appliedDiscount = {
          valueType: "FIXED_AMOUNT",
          value: parseFloat((original - discounted).toFixed(2)),
          title: "Standing order price",
        };
      }
      return item;
    } else {
      // Custom line item (no variant) — preserve title, price, quantity
      return {
        title: node.title,
        originalUnitPrice: node.discountedUnitPrice ?? node.originalUnitPrice,
        quantity: node.quantity,
        taxable: node.taxable ?? true,
      };
    }
  });

  console.log(`[draft-orders] Refreshing prices on ${draftOrderId} (${lineItems.length} items)`);
  await updateDraftOrder(admin, { draftOrderId, lineItems });
}

export async function completeDraftOrderRecord(admin, recordId) {
  // Claim the record immediately to prevent concurrent runs from processing it twice
  const claimed = await prisma.draftOrderRecord.updateMany({
    where: { id: recordId, status: { in: ["open", "locked"] } },
    data: { status: "processing" },
  });
  if (claimed.count === 0) {
    // Another run already claimed it
    return null;
  }

  let record;
  try {
    record = await prisma.draftOrderRecord.findUnique({
      where: { id: recordId },
      include: { standingOrder: true },
    });

    let order;
    try {
      order = await createOrderFromDraft(admin, record.shopifyDraftOrderId);
    } catch (priceErr) {
      // Shopify rejects completion when a draft was manually edited and its
      // custom prices are now considered stale. Fix: re-push the current line
      // items so Shopify re-validates, then retry once.
      if (priceErr.message.includes("previously proposed price")) {
        console.log(`[draft-orders] Stale price on record ${recordId} — refreshing and retrying`);
        await refreshDraftOrderPrices(admin, record.shopifyDraftOrderId);
        order = await createOrderFromDraft(admin, record.shopifyDraftOrderId);
      } else {
        throw priceErr;
      }
    }

    const orderId = order?.id || null;
    const orderName = order?.name || null;

    await prisma.draftOrderRecord.update({
      where: { id: recordId },
      data: { status: "completed", completedOrderId: orderId, completedOrderName: orderName },
    });
    return orderId;
  } catch (err) {
    // Roll back to locked so it can be retried
    await prisma.draftOrderRecord.update({
      where: { id: recordId },
      data: { status: "locked" },
    });
    throw err;
  }
}
