import { redirect } from "react-router";
import { useActionData } from "react-router";
import portalCss from "../styles/portal.css?url";
import { getSession, commitSession } from "../portal-session.server";
import { customerLogin, getCustomerByToken } from "../services/shopify-storefront.server";

export const links = () => [{ rel: "stylesheet", href: portalCss }];

export const loader = async ({ request }) => {
  const session = await getSession(request.headers.get("Cookie"));
  if (session.get("customer")) return redirect("/portal/orders");
  return null;
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const email = formData.get("email");
  const password = formData.get("password");

  if (!email || !password) return { error: "Email and password are required." };

  try {
    const tokenData = await customerLogin(email, password);
    const customer = await getCustomerByToken(tokenData.accessToken);

    const session = await getSession(request.headers.get("Cookie"));
    session.set("customer", {
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName || customer.firstName,
      accessToken: tokenData.accessToken,
      expiresAt: tokenData.expiresAt,
    });

    return redirect("/portal/orders", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  } catch (err) {
    return { error: err.message || "Invalid email or password." };
  }
};

export default function PortalLogin() {
  const actionData = useActionData();

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h2>Sign in to view your orders</h2>
        {actionData?.error && (
          <div className="alert alert-error">{actionData.error}</div>
        )}
        <form method="POST">
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" required autoFocus autoComplete="email" />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <button className="btn btn-primary" type="submit" style={{ width: "100%", padding: "0.625rem" }}>
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
