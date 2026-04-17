import { createCookieSessionStorage, redirect } from "react-router";

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: "__portal_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [process.env.SESSION_SECRET || "portal-secret-change-me"],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
});

export { getSession, commitSession, destroySession };

export async function requirePortalCustomer(request) {
  const session = await getSession(request.headers.get("Cookie"));
  const customer = session.get("customer");
  if (!customer) throw redirect("/portal/login");
  return customer;
}
