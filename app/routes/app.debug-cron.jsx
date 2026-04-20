import { authenticate } from "../shopify.server";
import { runDraftOrderCreator, runDraftOrderCompleter } from "../cron.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const job = url.searchParams.get("job") || "creator";

  if (job === "completer") {
    await runDraftOrderCompleter();
    return new Response("Completer job ran — check PM2 logs", { headers: { "Content-Type": "text/plain" } });
  }

  await runDraftOrderCreator();
  return new Response("Creator job ran — check PM2 logs", { headers: { "Content-Type": "text/plain" } });
};
