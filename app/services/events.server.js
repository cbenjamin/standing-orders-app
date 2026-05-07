import prisma from "../db.server.js";

export async function logEvent(standingOrderId, draftOrderRecordId, eventType, metadata = null) {
  try {
    await prisma.standingOrderEvent.create({
      data: {
        standingOrderId,
        draftOrderRecordId: draftOrderRecordId ?? null,
        eventType,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (err) {
    console.error(`[events] Failed to log event ${eventType} for standing order ${standingOrderId}:`, err.message);
  }
}
