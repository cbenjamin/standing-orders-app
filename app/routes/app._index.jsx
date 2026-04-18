import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  return redirect(`/app/standing-orders?${url.searchParams.toString()}`);
};
