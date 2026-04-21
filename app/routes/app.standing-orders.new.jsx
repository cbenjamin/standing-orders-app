import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useActionData, useNavigation, useNavigate, useFetcher, Form, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { searchCustomers, searchProducts } from "../services/shopify-graphql.server";

const DAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

// Customer + product search API endpoints used by the form's fetchers
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "search-customers") {
    const q = formData.get("q");
    const customers = await searchCustomers(admin, q);
    return { customers };
  }

  if (intent === "search-products") {
    const q = formData.get("q");
    const products = await searchProducts(admin, q);
    return { products };
  }

  // Main create action
  const name = formData.get("name");
  const shopifyCustomerId = formData.get("shopifyCustomerId");
  const customerName = formData.get("customerName");
  const customerEmail = formData.get("customerEmail");
  const startDate = formData.get("startDate");
  const endDate = formData.get("endDate");
  const deliveryDay = parseInt(formData.get("deliveryDay"), 10);
  const closeDay = (deliveryDay - 1 + 7) % 7;
  const closeTime = formData.get("closeTime") || "12:00";
  const itemsJson = formData.get("items");

  if (!name || !shopifyCustomerId || !startDate || !endDate || !itemsJson) {
    return { error: "Please fill in all required fields." };
  }

  let items;
  try {
    items = JSON.parse(itemsJson);
  } catch {
    return { error: "Invalid items data." };
  }

  if (!items.length) return { error: "Please add at least one item." };
  if (new Date(endDate) <= new Date(startDate)) {
    return { error: "End date must be after start date." };
  }

  const order = await prisma.standingOrder.create({
    data: {
      shopifyCustomerId,
      customerName,
      customerEmail,
      name,
      startDate,
      endDate,
      deliveryDay,
      closeDay,
      closeTime,
      status: "active",
      items: {
        create: items.map((item) => ({
          shopifyVariantId: item.shopifyVariantId,
          productTitle: item.productTitle,
          variantTitle: item.variantTitle || null,
          price: item.price,
          quantity: item.quantity,
        })),
      },
    },
  });

  return redirect(`/app/standing-orders/${order.id}`);
};

export default function NewStandingOrder() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSubmitting = navigation.state === "submitting";

  const customerFetcher = useFetcher();
  const productFetcher = useFetcher();

  const customerInputRef = useRef(null);
  const productInputRef = useRef(null);

  const [customer, setCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [items, setItems] = useState([]);
  const [deliveryDay, setDeliveryDay] = useState("3");

  const closeDay = (parseInt(deliveryDay, 10) - 1 + 7) % 7;
  const closeDayLabel = DAY_OPTIONS.find((o) => o.value === String(closeDay))?.label;

  const handleCustomerSearch = useCallback(
    (val) => {
      setCustomerSearch(val);
      if (val.length >= 2) {
        customerFetcher.submit({ intent: "search-customers", q: val }, { method: "POST" });
      }
    },
    [customerFetcher],
  );

  const handleProductSearch = useCallback(
    (val) => {
      setProductSearch(val);
      if (val.length >= 2) {
        productFetcher.submit({ intent: "search-products", q: val }, { method: "POST" });
      }
    },
    [productFetcher],
  );

  const addItem = useCallback(
    (product, variant) => {
      if (items.some((i) => i.shopifyVariantId === variant.id)) return;
      setItems((prev) => [
        ...prev,
        {
          shopifyVariantId: variant.id,
          productTitle: product.title,
          variantTitle: variant.title !== "Default Title" ? variant.title : "",
          price: variant.price,
          quantity: 1,
        },
      ]);
      setProductSearch("");
    },
    [items],
  );

  const updateQty = useCallback((idx, qty) => {
    setItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, quantity: Math.max(1, parseInt(qty) || 1) } : item)),
    );
  }, []);

  const removeItem = useCallback((idx) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const customerResults = customerFetcher.data?.customers || [];
  const productResults = productFetcher.data?.products || [];

  return (
    <s-page heading="Create Standing Order">
      <s-button slot="primary-action" variant="tertiary" onClick={() => navigate("/app/standing-orders")}>
        Cancel
      </s-button>

      <Form method="POST">
        <input type="hidden" name="intent" value="create" />
        <input type="hidden" name="shopifyCustomerId" value={customer?.id || ""} />
        <input type="hidden" name="customerName" value={customer?.displayName || ""} />
        <input type="hidden" name="customerEmail" value={customer?.email || ""} />
        <input type="hidden" name="items" value={JSON.stringify(items)} />

        {actionData?.error && (
          <s-banner tone="critical" style={{ marginBottom: "1rem" }}>
            {actionData.error}
          </s-banner>
        )}

        {/* Customer */}
        <s-section heading="Customer">
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={labelStyle}>Customer *</label>
            {customer ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem", border: "1px solid #e1e3e5", borderRadius: 4 }}>
                <div style={{ flex: 1 }}>
                  <strong>{customer.displayName}</strong>
                  <span style={{ color: "#6d7175", marginLeft: "0.5rem", fontSize: "0.875rem" }}>
                    {customer.email}
                  </span>
                </div>
                <button type="button" onClick={() => setCustomer(null)} style={clearBtnStyle}>
                  Change
                </button>
              </div>
            ) : (
              <div>
                <input
                  ref={customerInputRef}
                  style={inputStyle}
                  placeholder="Search by name or email…"
                  value={customerSearch}
                  onChange={(e) => handleCustomerSearch(e.target.value)}
                  autoComplete="off"
                />
                {customerResults.length > 0 && (
                  <DropdownList anchorRef={customerInputRef}>
                    {customerResults.map((c) => (
                      <DropdownItem
                        key={c.id}
                        onClick={() => { setCustomer(c); setCustomerSearch(""); }}
                      >
                        <strong>{c.displayName}</strong>
                        <span style={{ color: "#6d7175", marginLeft: "0.5rem", fontSize: "0.8125rem" }}>{c.email}</span>
                      </DropdownItem>
                    ))}
                  </DropdownList>
                )}
              </div>
            )}
          </div>
        </s-section>

        {/* Details */}
        <s-section heading="Order details">
          <div style={formRowStyle}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Standing order name *</label>
              <input name="name" style={inputStyle} placeholder="e.g. Chef Marco — Weekly Produce" required />
            </div>
          </div>
          <div style={{ ...formRowStyle, gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Start date *</label>
              <input name="startDate" type="date" style={inputStyle} required />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>End date *</label>
              <input name="endDate" type="date" style={inputStyle} required />
            </div>
          </div>
          <div style={{ ...formRowStyle, gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Delivery day *</label>
              <select
                name="deliveryDay"
                style={inputStyle}
                value={deliveryDay}
                onChange={(e) => setDeliveryDay(e.target.value)}
              >
                {DAY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Customer deadline (auto)</label>
              <input
                style={{ ...inputStyle, background: "#f6f6f7", color: "#6d7175" }}
                value={closeDayLabel}
                disabled
                readOnly
              />
            </div>
          </div>
          <div style={{ ...formRowStyle, gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Cutoff time (EST) *</label>
              <input name="closeTime" type="time" style={inputStyle} defaultValue="12:00" required />
              <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginTop: "0.25rem" }}>
                Order locks for editing at this time on the deadline day.
              </p>
            </div>
            <div style={{ flex: 1 }} />
          </div>
        </s-section>

        {/* Items */}
        <s-section heading="Items">
          <p style={{ fontSize: "0.875rem", color: "#6d7175", marginBottom: "0.75rem" }}>
            These items are included every week. Customers can increase quantities but cannot remove them.
          </p>

          {items.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                  {["Product", "Price", "Min qty", ""].map((h) => (
                    <th key={h} style={{ padding: "0.4rem 0.6rem", textAlign: "left", color: "#6d7175", fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.shopifyVariantId} style={{ borderBottom: "1px solid #f6f6f7" }}>
                    <td style={{ padding: "0.5rem 0.6rem" }}>
                      <div style={{ fontWeight: 500 }}>{item.productTitle}</div>
                      {item.variantTitle && <div style={{ color: "#6d7175", fontSize: "0.8125rem" }}>{item.variantTitle}</div>}
                    </td>
                    <td style={{ padding: "0.5rem 0.6rem" }}>${item.price}</td>
                    <td style={{ padding: "0.5rem 0.6rem" }}>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateQty(idx, e.target.value)}
                        style={{ width: 68, padding: "0.25rem 0.4rem", border: "1px solid #8c9196", borderRadius: 4, textAlign: "center" }}
                      />
                    </td>
                    <td style={{ padding: "0.5rem 0.6rem" }}>
                      <button type="button" onClick={() => removeItem(idx)} style={{ ...clearBtnStyle, color: "#d72c0d" }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div>
            <input
              ref={productInputRef}
              style={inputStyle}
              placeholder="Search products to add…"
              value={productSearch}
              onChange={(e) => handleProductSearch(e.target.value)}
              autoComplete="off"
            />
            {productResults.length > 0 && productSearch.length >= 2 && (
              <DropdownList anchorRef={productInputRef}>
                {productResults.flatMap((p) =>
                  p.variants.map((v) => (
                    <DropdownItem key={v.id} onClick={() => addItem(p, v)}>
                      <strong>{p.title}</strong>
                      {v.title !== "Default Title" && (
                        <span style={{ color: "#6d7175", marginLeft: "0.5rem" }}>— {v.title}</span>
                      )}
                      <span style={{ color: "#6d7175", marginLeft: "0.5rem" }}>${v.price}</span>
                    </DropdownItem>
                  )),
                )}
              </DropdownList>
            )}
          </div>
        </s-section>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
          <s-button variant="tertiary" onClick={() => navigate("/app/standing-orders")}>
            Cancel
          </s-button>
          <s-button
            variant="primary"
            disabled={isSubmitting || undefined}
            onClick={(e) => e.currentTarget.closest("form")?.requestSubmit()}
          >
            {isSubmitting ? "Creating…" : "Create standing order"}
          </s-button>
        </div>
      </Form>
    </s-page>
  );
}

// Small shared sub-components
function DropdownList({ anchorRef, children }) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (anchorRef?.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom, left: r.left, width: r.width });
    }
  });

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={{
      position: "fixed", top: pos.top, left: pos.left, width: pos.width,
      zIndex: 9999, border: "1px solid #e1e3e5", borderRadius: 4, background: "#fff",
      boxShadow: "0 4px 12px rgba(0,0,0,0.12)", maxHeight: 240, overflowY: "auto",
    }}>
      {children}
    </div>,
    document.body,
  );
}

function DropdownItem({ onClick, children }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: "0.5rem 0.75rem", cursor: "pointer", borderBottom: "1px solid #f6f6f7", fontSize: "0.875rem" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f7")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      {children}
    </div>
  );
}

// Style constants
const labelStyle = { display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.375rem" };
const inputStyle = {
  width: "100%", padding: "0.5rem 0.75rem",
  border: "1px solid #8c9196", borderRadius: 4, fontSize: "0.9375rem",
  background: "#fff",
};
const formRowStyle = { display: "flex", marginBottom: "0.75rem" };
const clearBtnStyle = {
  background: "none", border: "none", cursor: "pointer",
  color: "#008060", fontSize: "0.875rem", padding: 0,
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
