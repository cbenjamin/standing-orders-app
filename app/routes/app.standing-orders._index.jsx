import { useLoaderData, useNavigate, useSearchParams, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const showArchived = url.searchParams.get("archived") === "1";

  const orders = await prisma.standingOrder.findMany({
    where: showArchived ? { status: "archived" } : { status: { not: "archived" } },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  const archivedCount = await prisma.standingOrder.count({ where: { status: "archived" } });

  return { orders, showArchived, archivedCount };
};

export default function StandingOrderList() {
  const { orders, showArchived, archivedCount } = useLoaderData();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const toggleArchived = () => {
    if (showArchived) {
      setSearchParams({});
    } else {
      setSearchParams({ archived: "1" });
    }
  };

  return (
    <s-page heading="Standing Orders">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/standing-orders/new")}>
        Create standing order
      </s-button>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e1e3e5", marginBottom: "1rem" }}>
        <button onClick={() => setSearchParams({})} style={tabStyle(!showArchived)}>
          Active
        </button>
        <button onClick={() => setSearchParams({ archived: "1" })} style={tabStyle(showArchived)}>
          Archived {archivedCount > 0 && <span style={countBadgeStyle}>{archivedCount}</span>}
        </button>
      </div>

      {orders.length === 0 ? (
        <s-section heading={showArchived ? "No archived standing orders" : "No standing orders yet"}>
          <s-paragraph>
            {showArchived
              ? "Archived standing orders will appear here."
              : "Create your first standing order to start automating weekly deliveries for your chefs."}
          </s-paragraph>
          {!showArchived && (
            <s-button onClick={() => navigate("/app/standing-orders/new")}>
              Create standing order
            </s-button>
          )}
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
                <tr key={order.id} style={{ borderBottom: "1px solid #f1f1f1", cursor: "pointer" }}>
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
    archived: { background: "#e1e3e5", color: "#3d3d3d" },
  };
  const style = styles[status] ?? { background: "#e1e3e5", color: "#3d3d3d" };
  return (
    <span style={{ ...style, padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 500 }}>
      {status}
    </span>
  );
}

const tabStyle = (active) => ({
  background: "none",
  border: "none",
  borderBottom: active ? "2px solid #008060" : "2px solid transparent",
  padding: "0.625rem 1rem",
  cursor: "pointer",
  fontSize: "0.875rem",
  fontWeight: active ? 600 : 400,
  color: active ? "#008060" : "#6d7175",
  marginBottom: "-1px",
});

const countBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#e1e3e5",
  color: "#3d3d3d",
  borderRadius: 10,
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0 6px",
  marginLeft: "0.375rem",
  minWidth: 18,
  height: 18,
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
