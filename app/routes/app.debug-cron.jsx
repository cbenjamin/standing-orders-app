import { runDraftOrderCreator, runDraftOrderCompleter } from "../cron.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== (process.env.DEBUG_SECRET || "changeme")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const job = url.searchParams.get("job") || "creator";
  if (job === "completer") {
    await runDraftOrderCompleter();
    return new Response("Completer job ran — check PM2 logs", { headers: { "Content-Type": "text/plain" } });
  }

  await runDraftOrderCreator();
  return new Response("Creator job ran — check PM2 logs", { headers: { "Content-Type": "text/plain" } });
};
