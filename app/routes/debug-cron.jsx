import { runDraftOrderCreator, runDraftOrderLocker, runDraftOrderCompleter, runDraftOrderReminder } from "../cron.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== (process.env.DEBUG_SECRET || "changeme")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const job = url.searchParams.get("job") || "creator";

  if (job === "info") {
    const now = new Date();
    const records = await prisma.draftOrderRecord.findMany({
      include: { standingOrder: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const lines = [
      `Server time: ${now.toISOString()}`,
      `Server day (getDay): ${now.getDay()} (0=Sun, 1=Mon … 6=Sat)`,
      ``,
      `Draft order records (last 10):`,
      ...records.map((r) =>
        `  id=${r.id} status=${r.status} deliveryDate=${r.deliveryDate} ` +
        `standingOrder.closeDay=${r.standingOrder.closeDay} standingOrder.deliveryDay=${r.standingOrder.deliveryDay}`
      ),
    ];
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain" } });
  }

  if (job === "completer") {
    await runDraftOrderCompleter();
    return new Response("Completer job ran — check PM2 logs", { headers: { "Content-Type": "text/plain" } });
  }
  if (job === "locker") {
    await runDraftOrderLocker();
    return new Response("Locker job ran — check PM2 logs", { headers: { "Content-Type": "text/plain" } });
  }
  if (job === "reminder") {
    await runDraftOrderReminder();
    return new Response("Reminder job ran — check PM2 logs", { headers: { "Content-Type": "text/plain" } });
  }

  await runDraftOrderCreator();
  return new Response("Creator job ran — check PM2 logs", { headers: { "Content-Type": "text/plain" } });
};
