import { useState, useCallback } from "react";
import { useLoaderData, useActionData, useFetcher, Form, redirect } from "react-router";
import portalCss from "../styles/portal.css?url";
import { requirePortalCustomer, getSession, destroySession } from "../portal-session.server";
import { unauthenticated } from "../shopify.server";
import { getDraftOrderDetails, updateDraftOrder } from "../services/shopify-graphql.server";
import { applyCustomerDraftOrderUpdate } from "../services/draft-orders.server";
import { searchStorefrontProducts } from "../services/shopify-storefront.server";
import prisma from "../db.server";

export const links = () => [{ rel: "stylesheet", href: portalCss }];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const loader = async ({ request }) => {
  const customer = await requirePortalCustomer(request);

  const records = await prisma.draftOrderRecord.findMany({
    where: {
      status: "open",
      standingOrder: { shopifyCustomerId: customer.id },
    },
    include: { standingOrder: true, items: true },
    orderBy: { deliveryDate: "asc" },
  });

  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const { admin } = await unauthenticated.admin(shop);

  const orders = await Promise.all(
    records.map(async (record) => {
      const details = await getDraftOrderDetails(admin, record.shopifyDraftOrderId);
      return {
        id: record.id,
        shopifyDraftOrderId: record.shopifyDraftOrderId,
        shopifyDraftOrderName: record.shopifyDraftOrderName,
        deliveryDate: record.deliveryDate,
        status: record.status,
        closeDay: record.standingOrder.closeDay,
        standingOrderName: record.standingOrder.name,
        minimums: Object.fromEntries(
          record.items.map((i) => [
            i.shopifyVariantId,
            { minimumQuantity: i.minimumQuantity, isStandingItem: i.isStandingItem },
          ]),
        ),
        lineItems: (details?.lineItems?.edges || []).map(({ node }) => ({
          id: node.id,
          title: node.title,
          variantTitle: node.variant?.title !== "Default Title" ? node.variant?.title : "",
          variantId: node.variant?.id || null,
          price: node.originalUnitPrice,
          quantity: node.quantity,
        })),
        subtotalPrice: details?.subtotalPrice,
      };
    }),
  );

  return { customer, orders };
};

export const action = async ({ request }) => {
  const customer = await requirePortalCustomer(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "logout") {
    const session = await getSession(request.headers.get("Cookie"));
    return redirect("/portal/login", {
      headers: { "Set-Cookie": await destroySession(session) },
    });
  }

  if (intent === "search-products") {
    const q = formData.get("q");
    const products = await searchStorefrontProducts(q);
    return { searchResults: products };
  }

  if (intent === "update-order") {
    const recordId = formData.get("recordId");
    const lineItemsJson = formData.get("lineItems");
    let lineItems;
    try { lineItems = JSON.parse(lineItemsJson); } catch { return { error: "Invalid data." }; }

    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const { admin } = await unauthenticated.admin(shop);

    try {
      await applyCustomerDraftOrderUpdate(admin, recordId, lineItems);
      return { success: true, updatedRecordId: Number(recordId) };
    } catch (err) {
      return { error: err.message, failedRecordId: Number(recordId) };
    }
  }

  return null;
};

export default function PortalOrders() {
  const { customer, orders } = useLoaderData();
  const actionData = useActionData();
  const productFetcher = useFetcher();

  return (
    <>
      <header className="portal-header">
        <h1>Your upcoming orders</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.875rem", color: "#6d7175" }}>
            {customer.displayName || customer.email}
          </span>
          <Form method="POST">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" className="btn btn-secondary">Sign out</button>
          </Form>
        </div>
      </header>

      <div className="portal-container">
        {orders.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
            <p style={{ color: "#6d7175" }}>No upcoming orders right now.</p>
            <p style={{ color: "#6d7175", fontSize: "0.875rem", marginTop: "0.5rem" }}>
              Your standing order will appear here each week before your delivery date.
            </p>
          </div>
        ) : (
          orders.map((order) => (
            <DraftOrderCard
              key={order.id}
              order={order}
              actionData={actionData}
              productFetcher={productFetcher}
            />
          ))
        )}
      </div>
    </>
  );
}

function DraftOrderCard({ order, actionData, productFetcher }) {
  const isLocked = order.status === "locked" || order.status === "completed";
  const serverError = actionData?.failedRecordId === order.id ? actionData.error : null;
  const serverSuccess = actionData?.updatedRecordId === order.id ? actionData.success : false;

  const [lines, setLines] = useState(
    order.lineItems.map((li) => ({
      ...li,
      isStanding: Boolean(li.variantId && order.minimums[li.variantId]?.isStandingItem),
      minQty: li.variantId ? (order.minimums[li.variantId]?.minimumQuantity ?? 0) : 0,
    })),
  );
  const [productSearch, setProductSearch] = useState("");
  const [localError, setLocalError] = useState("");

  const handleQtyChange = useCallback(
    (idx, val) => {
      const qty = parseInt(val, 10);
      if (isNaN(qty)) return;
      setLines((prev) =>
        prev.map((line, i) => {
          if (i !== idx) return line;
          return { ...line, quantity: line.isStanding ? Math.max(qty, line.minQty) : Math.max(qty, 1) };
        }),
      );
    },
    [],
  );

  const handleRemove = useCallback((idx) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleProductSearch = useCallback(
    (q) => {
      setProductSearch(q);
      if (q.length >= 2) productFetcher.submit({ intent: "search-products", q }, { method: "POST", action: "/portal/orders" });
    },
    [productFetcher],
  );

  const addProduct = useCallback(
    (product, variant) => {
      if (lines.some((l) => l.variantId === variant.id)) return;
      const price = variant.price?.amount ?? variant.price;
      setLines((prev) => [
        ...prev,
        { variantId: variant.id, title: product.title, variantTitle: variant.title !== "Default Title" ? variant.title : "", price, quantity: 1, isStanding: false, minQty: 0 },
      ]);
      setProductSearch("");
    },
    [lines],
  );

  const validateAndGetLineItems = useCallback(() => {
    for (const line of lines) {
      if (line.isStanding && line.quantity < line.minQty) {
        setLocalError(`Quantity for "${line.title}" cannot be below ${line.minQty}.`);
        return null;
      }
    }
    setLocalError("");
    return lines.filter((l) => l.variantId).map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
  }, [lines]);

  const subtotal = lines.reduce((sum, l) => sum + parseFloat(l.price || 0) * l.quantity, 0);
  const searchResults = productFetcher.data?.searchResults || [];

  return (
    <div className="card">
      <div className="order-meta">
        <span>{order.shopifyDraftOrderName || `Draft #${order.id}`}</span>
        <span>Delivery: <strong>{order.deliveryDate}</strong></span>
        <span>Deadline: <strong>{DAY_NAMES[order.closeDay]}</strong></span>
        {isLocked && <span className="badge badge-locked">Locked — no further edits</span>}
      </div>

      {(serverError || localError) && (
        <div className="alert alert-error">{serverError || localError}</div>
      )}
      {serverSuccess && (
        <div className="alert alert-success">Order updated successfully.</div>
      )}

      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style={{ width: 90 }}>Qty</th>
            <th style={{ textAlign: "right", width: 100 }}>Line total</th>
            {!isLocked && <th style={{ width: 70 }}></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => (
            <tr key={line.variantId || idx}>
              <td>
                <div style={{ fontWeight: 500 }}>{line.title}</div>
                {line.variantTitle && <div style={{ color: "#6d7175", fontSize: "0.8125rem" }}>{line.variantTitle}</div>}
                {line.isStanding && <span className="badge badge-standing">Standing order item</span>}
              </td>
              <td>
                {isLocked ? (
                  <span>{line.quantity}</span>
                ) : (
                  <>
                    <input
                      className="qty-input"
                      type="number"
                      min={line.isStanding ? line.minQty : 1}
                      value={line.quantity}
                      onChange={(e) => handleQtyChange(idx, e.target.value)}
                    />
                    {line.isStanding && (
                      <div style={{ fontSize: "0.75rem", color: "#6d7175" }}>min {line.minQty}</div>
                    )}
                  </>
                )}
              </td>
              <td style={{ textAlign: "right" }}>
                ${(parseFloat(line.price || 0) * line.quantity).toFixed(2)}
              </td>
              {!isLocked && (
                <td>
                  {!line.isStanding && (
                    <button className="btn btn-danger" onClick={() => handleRemove(idx)}>Remove</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={isLocked ? 2 : 3} style={{ textAlign: "right" }}>Subtotal</td>
            <td style={{ textAlign: "right" }}>${subtotal.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      {!isLocked && (
        <>
          <div className="add-item-search">
            <input
              type="text"
              placeholder="Search to add a product…"
              value={productSearch}
              onChange={(e) => handleProductSearch(e.target.value)}
              autoComplete="off"
            />
            {searchResults.length > 0 && productSearch.length >= 2 && (
              <div className="search-results">
                {searchResults.flatMap((p) =>
                  p.variants.map((v) => (
                    <div
                      key={v.id}
                      className="search-result-item"
                      onClick={() => addProduct(p, v)}
                    >
                      {p.title}
                      {v.title !== "Default Title" && ` — ${v.title}`}
                      <span className="search-result-price">
                        ${v.price?.amount ?? v.price}
                      </span>
                    </div>
                  )),
                )}
              </div>
            )}
          </div>

          <Form method="POST">
            <input type="hidden" name="intent" value="update-order" />
            <input type="hidden" name="recordId" value={order.id} />
            <input type="hidden" name="lineItems" value={JSON.stringify(
              lines.filter((l) => l.variantId).map((l) => ({ variantId: l.variantId, quantity: l.quantity }))
            )} />
            <div className="actions-row">
              <button
                type="submit"
                className="btn btn-primary"
                onClick={(e) => {
                  const lineItems = validateAndGetLineItems();
                  if (!lineItems) e.preventDefault();
                  else e.currentTarget.closest("form").querySelector("[name=lineItems]").value = JSON.stringify(lineItems);
                }}
              >
                Save changes
              </button>
            </div>
          </Form>
        </>
      )}
    </div>
  );
}
