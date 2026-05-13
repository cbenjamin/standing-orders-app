import { useLoaderData, useSearchParams, Link } from "react-router";
import { useState, useEffect, useRef } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const statusFilter = url.searchParams.get("status") || "all";

  const searchFilter = q
    ? {
        OR: [
          { shopifyDraftOrderName: { contains: q } },
          { completedOrderName: { contains: q } },
          { standingOrder: { name: { contains: q } } },
          { standingOrder: { customerName: { contains: q } } },
          { standingOrder: { customerEmail: { contains: q } } },
        ],
      }
    : {};

  const statusCondition =
    statusFilter !== "all" ? { status: statusFilter } : {};

  const records = await prisma.draftOrderRecord.findMany({
    where: { ...statusCondition, ...searchFilter },
    include: { standingOrder: { select: { name: true, customerName: true, customerEmail: true } } },
    orderBy: { deliveryDate: "desc" },
    take: 200,
  });

  return { records, q, statusFilter };
};

const STATUSES = ["all", "open", "locked", "processing", "completed"];

export default function OrdersList() {
  const { records, q, statusFilter } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(q);
  const debounceRef = useRef(null);

  // Sync input when status tab switches (which may clear q)
  useEffect(() => {
    setSearchValue(q);
  }, [q]);

  const handleSearch = (value) => {
    setSearchValue(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (value) params.q = value;
      setSearchParams(params);
    }, 400);
  };

  const switchStatus = (s) => {
    const params = {};
    if (s !== "all") params.status = s;
    if (searchValue) params.q = searchValue;
    setSearchParams(params);
  };

  return (
    <s-page heading="Orders">
      {/* Status tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e1e3e5", marginBottom: "1rem" }}>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => switchStatus(s)} style={tabStyle(statusFilter === s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: "1rem" }}>
        <input
          type="search"
          placeholder="Search by standing order, customer, or order #…"
          value={searchValue}
          onChange={(e) => handleSearch(e.target.value)}
          style={searchInputStyle}
        />
      </div>

      {records.length === 0 ? (
        <s-section heading="No orders found">
          <s-paragraph>
            {q
              ? `No orders matched "${q}".`
              : "No draft order records exist yet. They are created automatically by the daily scheduler."}
          </s-paragraph>
        </s-section>
      ) : (
        <s-section>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                {["ID", "Standing Order", "Customer", "Delivery Date", "Draft Order", "Completed Order", "Status"].map((h) => (
                  <th
                    key={h}
                    style={{ padding: "0.5rem 0.75rem", textAlign: "left", color: "#6d7175", fontWeight: 500 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.id} style={{ borderBottom: "1px solid #f1f1f1" }}>
                  <td style={{ padding: "0.75rem", fontVariantNumeric: "tabular-nums", color: "#6d7175" }}>
                    {rec.id}
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    <Link
                      to={`/app/standing-orders/${rec.standingOrderId}`}
                      style={{ color: "#008060", fontWeight: 500, textDecoration: "none" }}
                    >
                      {rec.standingOrder?.name ?? "—"}
                    </Link>
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    <div style={{ fontWeight: 500 }}>{rec.standingOrder?.customerName ?? "—"}</div>
                    <div style={{ color: "#6d7175", fontSize: "0.8125rem" }}>{rec.standingOrder?.customerEmail ?? ""}</div>
                  </td>
                  <td style={{ padding: "0.75rem" }}>{formatDate(rec.deliveryDate)}</td>
                  <td style={{ padding: "0.75rem", fontVariantNumeric: "tabular-nums" }}>
                    {rec.shopifyDraftOrderName ?? "—"}
                  </td>
                  <td style={{ padding: "0.75rem", fontVariantNumeric: "tabular-nums" }}>
                    {rec.completedOrderName ?? "—"}
                  </td>
                  <td style={{ padding: "0.75rem" }}>
                    <StatusBadge status={rec.status} />
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
    open: { background: "#e3f1df", color: "#0d3b2e" },
    locked: { background: "#fff3cd", color: "#7c5501" },
    processing: { background: "#d4e9ff", color: "#0c3b6e" },
    completed: { background: "#e1e3e5", color: "#3d3d3d" },
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

const searchInputStyle = {
  width: "100%",
  maxWidth: 440,
  padding: "0.5rem 0.75rem",
  border: "1px solid #c9cccf",
  borderRadius: 6,
  fontSize: "0.875rem",
  outline: "none",
  boxSizing: "border-box",
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
