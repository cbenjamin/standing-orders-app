import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getCustomerTagsBatch } from "../services/shopify-graphql.server";

// ── Helpers ──────────────────────────────────────────────────────────────────

const RANGES = [
  { value: "7",   label: "7 days" },
  { value: "30",  label: "30 days" },
  { value: "90",  label: "90 days" },
  { value: "365", label: "12 months" },
  { value: "all", label: "All time" },
];

function sinceDate(range) {
  if (range === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - parseInt(range, 10));
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

/** Return the Sunday that starts the week containing dateStr */
function weekOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - date.getDay());
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

function fmtMoney(n) {
  return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "30";
  const since = sinceDate(range);

  const dateFilter = since ? { deliveryDate: { gte: since } } : {};
  const eventDateFilter = since
    ? { createdAt: { gte: new Date(since + "T00:00:00.000Z") } }
    : {};

  // All draft order records in the selected range
  const allRecords = await prisma.draftOrderRecord.findMany({
    where: dateFilter,
    select: {
      id: true,
      status: true,
      deliveryDate: true,
      standingOrderId: true,
      standingOrder: {
        select: {
          id: true,
          name: true,
          customerName: true,
          shopifyCustomerId: true,
          items: { select: { price: true, quantity: true } },
        },
      },
    },
  });

  // ── Top-level KPIs ──────────────────────────────────────────────────────────
  const completedCount = allRecords.filter((r) => r.status === "completed").length;
  const cancelledCount = allRecords.filter((r) => r.status === "cancelled").length;
  const openCount = allRecords.filter((r) =>
    ["open", "locked", "processing"].includes(r.status),
  ).length;
  const denominator = completedCount + cancelledCount;
  const conversionRate = denominator > 0
    ? Math.round((completedCount / denominator) * 100)
    : null;

  // ── Lost revenue from cancelled orders ──────────────────────────────────────
  let lostRevenue = 0;
  for (const r of allRecords) {
    if (r.status !== "cancelled") continue;
    for (const item of r.standingOrder?.items ?? []) {
      lostRevenue += parseFloat(item.price) * item.quantity;
    }
  }

  // ── Revenue & engagement (from customer_updated events) ─────────────────────
  const updateEvents = await prisma.standingOrderEvent.findMany({
    where: { eventType: "customer_updated", ...eventDateFilter },
    select: { metadata: true, draftOrderRecordId: true },
  });

  let additionalRevenue = 0;
  const modifiedOrderIds = new Set();
  for (const evt of updateEvents) {
    try {
      const meta = JSON.parse(evt.metadata || "{}");
      if (meta.additionalRevenue) additionalRevenue += meta.additionalRevenue;
      if (evt.draftOrderRecordId) modifiedOrderIds.add(evt.draftOrderRecordId);
    } catch { /* ignore parse errors */ }
  }
  const modifiedOrdersCount = modifiedOrderIds.size;
  const avgAdditional =
    modifiedOrdersCount > 0 ? additionalRevenue / modifiedOrdersCount : 0;
  const engagementRate =
    allRecords.length > 0
      ? Math.round((modifiedOrdersCount / allRecords.length) * 100)
      : 0;

  // ── Weekly trend (up to 12 weeks, desc) ─────────────────────────────────────
  const weekMap = {};
  for (const r of allRecords) {
    if (!["completed", "cancelled"].includes(r.status)) continue;
    const wk = weekOf(r.deliveryDate);
    if (!weekMap[wk]) weekMap[wk] = { completed: 0, cancelled: 0 };
    weekMap[wk][r.status]++;
  }
  const weeklyTrend = Object.entries(weekMap)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 12)
    .map(([week, { completed, cancelled }]) => ({
      week,
      completed,
      cancelled,
      rate:
        completed + cancelled > 0
          ? Math.round((completed / (completed + cancelled)) * 100)
          : null,
    }));

  // ── Per standing order breakdown ─────────────────────────────────────────────
  const soMap = {};
  for (const r of allRecords) {
    const so = r.standingOrder;
    if (!so) continue;
    if (!soMap[so.id]) {
      soMap[so.id] = {
        id: so.id,
        name: so.name,
        customerName: so.customerName,
        shopifyCustomerId: so.shopifyCustomerId,
        completed: 0,
        cancelled: 0,
        open: 0,
      };
    }
    if (r.status === "completed") soMap[so.id].completed++;
    else if (r.status === "cancelled") soMap[so.id].cancelled++;
    else soMap[so.id].open++;
  }

  // Batch-fetch route tags
  const uniqueCustomerIds = [
    ...new Set(Object.values(soMap).map((s) => s.shopifyCustomerId)),
  ];
  const tagsMap = await getCustomerTagsBatch(admin, uniqueCustomerIds);

  const perOrder = Object.values(soMap)
    .map((so) => {
      const tags = tagsMap[so.shopifyCustomerId] ?? [];
      const routeTag = tags.find((t) => t.toLowerCase().includes("route")) ?? null;
      const total = so.completed + so.cancelled;
      const rate = total > 0 ? Math.round((so.completed / total) * 100) : null;
      return { ...so, routeTag, rate };
    })
    .sort((a, b) => {
      // Worst conversion first; nulls (no closed orders yet) at bottom
      if (a.rate === null && b.rate === null) return 0;
      if (a.rate === null) return 1;
      if (b.rate === null) return -1;
      return a.rate - b.rate;
    });

  return {
    range,
    completedCount,
    cancelledCount,
    openCount,
    conversionRate,
    lostRevenue: parseFloat(lostRevenue.toFixed(2)),
    additionalRevenue: parseFloat(additionalRevenue.toFixed(2)),
    modifiedOrdersCount,
    avgAdditional: parseFloat(avgAdditional.toFixed(2)),
    totalInPeriod: allRecords.length,
    engagementRate,
    weeklyTrend,
    perOrder,
  };
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Analytics() {
  const {
    range,
    completedCount,
    cancelledCount,
    openCount,
    conversionRate,
    lostRevenue,
    additionalRevenue,
    modifiedOrdersCount,
    avgAdditional,
    totalInPeriod,
    engagementRate,
    weeklyTrend,
    perOrder,
  } = useLoaderData();

  const [, setSearchParams] = useSearchParams();
  const setRange = (r) => setSearchParams(r === "30" ? {} : { range: r });

  return (
    <s-page inlineSize="large" heading="Analytics">

      {/* ── Time range selector ──────────────────────────────────── */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e1e3e5", marginBottom: "1.5rem" }}>
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            style={tabStyle(range === r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Conversion & volume KPIs ────────────────────────────── */}
      <s-section>
        <div style={kpiGridStyle}>
          <KpiCard
            label="Conversion rate"
            value={conversionRate !== null ? `${conversionRate}%` : "—"}
            sub="completed ÷ (completed + cancelled)"
            accent={conversionRate !== null
              ? conversionRate >= 80 ? "green" : conversionRate >= 50 ? "yellow" : "red"
              : "neutral"}
          />
          <KpiCard label="Completed" value={completedCount} sub="converted to orders" accent="green" />
          <KpiCard label="Cancelled" value={cancelledCount} sub="deleted before converting" accent={cancelledCount > 0 ? "red" : "neutral"} />
          <KpiCard label="Open / pending" value={openCount} sub="open, locked, or processing" accent="neutral" />
        </div>
      </s-section>

      {/* ── Revenue & engagement KPIs ────────────────────────────── */}
      <s-section>
        <div style={kpiGridStyle}>
          <KpiCard
            label="Additional revenue"
            value={fmtMoney(additionalRevenue)}
            sub="from items customers added"
            accent="green"
          />
          <KpiCard
            label="Customer-modified orders"
            value={modifiedOrdersCount}
            sub={`of ${totalInPeriod} total (${engagementRate}%)`}
            accent="neutral"
          />
          <KpiCard
            label="Avg add'l per modified order"
            value={modifiedOrdersCount > 0 ? fmtMoney(avgAdditional) : "—"}
            sub="average additional spend"
            accent="neutral"
          />
          <KpiCard
            label="Lost revenue"
            value={fmtMoney(lostRevenue)}
            sub="base value of cancelled orders"
            accent={lostRevenue > 0 ? "red" : "neutral"}
          />
        </div>
      </s-section>

      {/* ── Weekly trend ─────────────────────────────────────────── */}
      <s-section heading="Weekly trend">
        {weeklyTrend.length === 0 ? (
          <p style={emptyStyle}>No closed orders in this period.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                {["Week of", "Completed", "Cancelled", "Conversion"].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeklyTrend.map((wk) => (
                <tr key={wk.week} style={{ borderBottom: "1px solid #f6f6f7" }}>
                  <td style={tdStyle}>{fmtDate(wk.week)}</td>
                  <td style={tdStyle}>{wk.completed}</td>
                  <td style={tdStyle}>{wk.cancelled}</td>
                  <td style={tdStyle}>
                    {wk.rate !== null ? (
                      <RateBadge rate={wk.rate} />
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      {/* ── Conversion by standing order ─────────────────────────── */}
      <s-section heading="Conversion by standing order">
        <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "1rem" }}>
          Sorted by conversion rate, lowest first. Orders with no closed records are shown at the bottom.
        </p>
        {perOrder.length === 0 ? (
          <p style={emptyStyle}>No records in this period.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                {["Standing order", "Customer", "Route", "Completed", "Cancelled", "Open", "Rate"].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perOrder.map((so) => (
                <tr key={so.id} style={{ borderBottom: "1px solid #f6f6f7" }}>
                  <td style={tdStyle}>
                    <a
                      href={`/app/standing-orders/${so.id}`}
                      style={{ color: "#008060", fontWeight: 500, textDecoration: "none" }}
                    >
                      {so.name}
                    </a>
                  </td>
                  <td style={tdStyle}>{so.customerName}</td>
                  <td style={tdStyle}>
                    {so.routeTag ? (
                      <span style={routeBadgeStyle}>{so.routeTag}</span>
                    ) : (
                      <span style={{ color: "#c9cccf" }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>{so.completed}</td>
                  <td style={tdStyle}>{so.cancelled}</td>
                  <td style={tdStyle}>{so.open}</td>
                  <td style={tdStyle}>
                    {so.rate !== null ? <RateBadge rate={so.rate} /> : "—"}
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

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent = "neutral" }) {
  const accentColors = {
    green:   { border: "#3db870", bg: "#f0faf4" },
    yellow:  { border: "#f4c142", bg: "#fffbf0" },
    red:     { border: "#e5484d", bg: "#fff5f5" },
    neutral: { border: "#e1e3e5", bg: "#ffffff" },
  };
  const { border, bg } = accentColors[accent] ?? accentColors.neutral;
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 8,
      padding: "1.25rem 1.5rem",
    }}>
      <div style={{ fontSize: "0.8125rem", color: "#6d7175", fontWeight: 500, marginBottom: "0.375rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1a1a1a", lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "0.75rem", color: "#6d7175", marginTop: "0.375rem" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function RateBadge({ rate }) {
  const color =
    rate >= 80 ? { background: "#e3f1df", color: "#0d3b2e" }
    : rate >= 50 ? { background: "#fff3cd", color: "#7c5501" }
    : { background: "#ffd2cc", color: "#7c1a00" };
  return (
    <span style={{ ...color, padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 600 }}>
      {rate}%
    </span>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

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

const kpiGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "1rem",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
};

const thStyle = {
  padding: "0.5rem 0.75rem",
  textAlign: "left",
  color: "#6d7175",
  fontWeight: 500,
};

const tdStyle = {
  padding: "0.75rem",
};

const emptyStyle = {
  fontSize: "0.875rem",
  color: "#6d7175",
};

const routeBadgeStyle = {
  background: "#e8f0fe",
  color: "#1a3d8f",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: "0.75rem",
  fontWeight: 500,
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
