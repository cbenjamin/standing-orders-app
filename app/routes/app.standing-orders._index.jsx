import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const orders = await prisma.standingOrder.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });
  return { orders };
};

export default function StandingOrderList() {
  const { orders } = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="Standing Orders">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/standing-orders/new")}>
        Create standing order
      </s-button>

      {orders.length === 0 ? (
        <s-section heading="No standing orders yet">
          <s-paragraph>
            Create your first standing order to start automating weekly deliveries for your chefs.
          </s-paragraph>
          <s-button onClick={() => navigate("/app/standing-orders/new")}>
            Create standing order
          </s-button>
        </s-section>
      ) : (
        <s-section>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                {["Name", "Customer", "Items", "Delivery day", "Date range", "Status"].map((h) => (
                  <th key={h} style={{ padding: "0.5rem 0.75rem", textAlign: "left", color: "#6d7175", fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  style={{ borderBottom: "1px solid #f1f1f1", cursor: "pointer" }}
                >
                  <td style={{ padding: "0.75rem" }}>
                    <Link
                      to={`/app/standing-orders/${order.id}`}
                      style={{ color: "#008060", fontWeight: 500, textDecoration: "none" }}
                    >
                      {order.name}
                    </Link>
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    <div style={{ fontWeight: 500 }}>{order.customerName}</div>
                    <div style={{ color: "#6d7175", fontSize: "0.8125rem" }}>{order.customerEmail}</div>
                  </td>
                  <td style={{ padding: "0.75rem" }}>{order._count.items}</td>
                  <td style={{ padding: "0.75rem" }}>{DAY_NAMES[order.deliveryDay]}</td>
                  <td style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "#6d7175" }}>
                    {order.startDate} → {order.endDate}
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-section>
      )}
    </s-page>
  );
}

function StatusBadge({ status }) {
  const styles = {
    active: { background: "#e3f1df", color: "#0d3b2e" },
    paused: { background: "#fff3cd", color: "#7c5501" },
    expired: { background: "#ffd2cc", color: "#7c1a00" },
  };
  const style = styles[status] ?? { background: "#e1e3e5", color: "#3d3d3d" };
  return (
    <span style={{ ...style, padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 500 }}>
      {status}
    </span>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
