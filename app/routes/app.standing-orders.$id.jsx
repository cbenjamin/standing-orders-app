import { useLoaderData, Form, useNavigation, useNavigate, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const order = await prisma.standingOrder.findUnique({
    where: { id: Number(params.id) },
    include: {
      items: true,
      draftOrders: { orderBy: { deliveryDate: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!order) throw new Response("Not Found", { status: 404 });
  return { order, shop: session.shop };
};

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "archive") {
    await prisma.standingOrder.update({
      where: { id: Number(params.id) },
      data: { status: "archived" },
    });
    return redirect("/app/standing-orders");
  }

  if (intent === "toggle-status") {
    const order = await prisma.standingOrder.findUnique({ where: { id: Number(params.id) } });
    const newStatus = order.status === "active" ? "paused" : "active";
    await prisma.standingOrder.update({
      where: { id: Number(params.id) },
      data: { status: newStatus },
    });
    return null;
  }

  return null;
};

// "gid://shopify/DraftOrder/123" → "123"
function gidToId(gid) {
  return gid?.split("/").pop();
}

export default function StandingOrderDetail() {
  const { order, shop } = useLoaderData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSubmitting = navigation.state === "submitting";

  const draftStatusColor = {
    open: { background: "#e3f1df", color: "#0d3b2e" },
    completed: { background: "#d1ecf1", color: "#0c5460" },
    locked: { background: "#fff3cd", color: "#7c5501" },
  };

  return (
    <s-page heading={order.name}>
      <s-button slot="primary-action" variant="primary" onClick={() => navigate(`/app/standing-orders/${order.id}/edit`)}>
        Edit
      </s-button>
      <s-button slot="primary-action" variant="tertiary" onClick={() => navigate("/app/standing-orders")}>
        ← Back
      </s-button>

      {/* Summary */}
      <s-section heading="Details">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          <div>
            <InfoRow label="Customer" value={order.customerName} />
            <InfoRow label="Email" value={order.customerEmail} />
            <InfoRow label="Status" value={<StatusBadge status={order.status} />} />
          </div>
          <div>
            <InfoRow label="Delivery day" value={DAY_NAMES[order.deliveryDay]} />
            <InfoRow label="Deadline day" value={DAY_NAMES[order.closeDay]} />
            <InfoRow label="Cutoff time (EST)" value={order.closeTime || "12:00"} />
            <InfoRow label="Date range" value={`${formatDate(order.startDate)} → ${formatDate(order.endDate)}`} />
            <InfoRow label="Creation email" value={order.sendCreationEmail ? "Enabled" : "Disabled"} />
            <InfoRow label="Reminder email" value={order.sendReminder ? "Enabled" : "Disabled"} />
          </div>
        </div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
          <Form method="POST">
            <input type="hidden" name="intent" value="toggle-status" />
            <s-button
              disabled={isSubmitting || undefined}
              onClick={(e) => e.currentTarget.closest("form")?.requestSubmit()}
            >
              {order.status === "active" ? "Pause" : "Resume"}
            </s-button>
          </Form>
          <Form method="POST">
            <input type="hidden" name="intent" value="archive" />
            <s-button
              tone="critical"
              disabled={isSubmitting || undefined}
              onClick={(e) => {
                if (confirm("Archive this standing order? No new draft orders will be created.")) {
                  e.currentTarget.closest("form")?.requestSubmit();
                }
              }}
            >
              Archive
            </s-button>
          </Form>
        </div>
      </s-section>

      {/* Items */}
      <s-section heading="Standing order items">
        <p style={{ fontSize: "0.875rem", color: "#6d7175", marginBottom: "0.75rem" }}>
          These items appear on every draft order. Customers can increase quantities but cannot remove them.
        </p>
        <table style={tableStyle}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
              {["Product", "Variant", "Price", "Min qty"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid #f6f6f7" }}>
                <td style={tdStyle}>{item.productTitle}</td>
                <td style={tdStyle}>{item.variantTitle || "—"}</td>
                <td style={tdStyle}>${item.price}</td>
                <td style={tdStyle}>{item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>

      {/* Activity log */}
      <s-section heading="Activity">
        {order.events.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "#6d7175" }}>No activity yet.</p>
        ) : (
          <>
            {/* Additional revenue summary */}
            {(() => {
              const totalAdditional = order.events
                .filter((e) => e.eventType === "customer_updated")
                .reduce((sum, e) => {
                  try { return sum + (JSON.parse(e.metadata)?.additionalRevenue ?? 0); } catch { return sum; }
                }, 0);
              return totalAdditional > 0 ? (
                <div style={{ background: "#f1f8f5", border: "1px solid #95c9b4", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", display: "flex", gap: "2rem" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#6d7175", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Additional revenue from modifications</div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0d3b2e" }}>${totalAdditional.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#6d7175", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Customer modifications</div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0d3b2e" }}>{order.events.filter((e) => e.eventType === "customer_updated").length}</div>
                  </div>
                </div>
              ) : null;
            })()}
            <table style={tableStyle}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                  {["Date", "Event", "Details"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.events.map((event) => {
                  let meta = {};
                  try { meta = JSON.parse(event.metadata) || {}; } catch {}
                  const label = {
                    creation_email_sent: "Creation email sent",
                    reminder_email_sent: "Reminder email sent",
                    customer_updated: "Customer updated order",
                  }[event.eventType] ?? event.eventType;
                  const detail = event.eventType === "customer_updated"
                    ? meta.additionalRevenue > 0
                      ? `+$${meta.additionalRevenue.toFixed(2)} above minimums`
                      : "No additional items"
                    : meta.draftOrderName ?? meta.deliveryDate ?? "—";
                  return (
                    <tr key={event.id} style={{ borderBottom: "1px solid #f6f6f7" }}>
                      <td style={{ ...tdStyle, color: "#6d7175", whiteSpace: "nowrap" }}>
                        {new Date(event.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} EST
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          ...({
                            creation_email_sent: { background: "#e3f1df", color: "#0d3b2e" },
                            reminder_email_sent: { background: "#e3f1df", color: "#0d3b2e" },
                            customer_updated: { background: "#d1ecf1", color: "#0c5460" },
                          }[event.eventType] ?? { background: "#e1e3e5", color: "#3d3d3d" }),
                          padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 500,
                        }}>
                          {label}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: "0.8125rem", color: "#6d7175" }}>{detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </s-section>

      {/* Draft orders */}
      <s-section heading="Generated draft orders">
        {order.draftOrders.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "#6d7175" }}>
            No draft orders generated yet. They will be created automatically each week.
          </p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                {["Draft order", "Delivery date", "Status", "Converted order"].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.draftOrders.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid #f6f6f7" }}>
                  <td style={tdStyle}>
                    {d.status === "completed" ? (
                      <span style={{ color: "#6d7175" }}>{d.shopifyDraftOrderName || "—"}</span>
                    ) : (
                      <a
                        href={`https://${shop}/admin/draft_orders/${gidToId(d.shopifyDraftOrderId)}`}
                        target="_blank" rel="noreferrer"
                        style={adminLinkStyle}
                      >
                        {d.shopifyDraftOrderName || d.shopifyDraftOrderId}
                      </a>
                    )}
                  </td>
                  <td style={tdStyle}>{formatDate(d.deliveryDate)}</td>
                  <td style={tdStyle}>
                    <span style={{
                      ...(draftStatusColor[d.status] || { background: "#e1e3e5", color: "#3d3d3d" }),
                      padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 500,
                    }}>
                      {d.status}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {d.completedOrderId ? (
                      <a
                        href={`https://${shop}/admin/orders/${gidToId(d.completedOrderId)}`}
                        target="_blank" rel="noreferrer"
                        style={adminLinkStyle}
                      >
                        {d.completedOrderName || d.completedOrderId}
                      </a>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.375rem 0", borderBottom: "1px solid #f6f6f7" }}>
      <span style={{ color: "#6d7175", fontSize: "0.875rem" }}>{label}</span>
      <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    active: { background: "#e3f1df", color: "#0d3b2e" },
    paused: { background: "#fff3cd", color: "#7c5501" },
    expired: { background: "#ffd2cc", color: "#7c1a00" },
    archived: { background: "#e1e3e5", color: "#3d3d3d" },
  };
  const style = styles[status] ?? { background: "#e1e3e5", color: "#3d3d3d" };
  return (
    <span style={{ ...style, padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 500 }}>
      {status}
    </span>
  );
}

const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" };
const thStyle = { padding: "0.5rem 0.75rem", textAlign: "left", color: "#6d7175", fontWeight: 500 };
const tdStyle = { padding: "0.625rem 0.75rem" };
const adminLinkStyle = { color: "#008060", fontWeight: 500, textDecoration: "none" };

export const headers = (headersArgs) => boundary.headers(headersArgs);
