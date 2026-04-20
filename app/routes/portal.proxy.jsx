import crypto from "crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getDraftOrderDetails } from "../services/shopify-graphql.server";
import { applyCustomerDraftOrderUpdate } from "../services/draft-orders.server";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function verifySignature(searchParams) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const signature = searchParams.get("signature");
  if (!signature || !secret) return false;
  const params = [];
  for (const [k, v] of searchParams.entries()) {
    if (k !== "signature") params.push(`${k}=${v}`);
  }
  params.sort();
  const digest = crypto.createHmac("sha256", secret).update(params.join("&")).digest("hex");
  return digest === signature;
}

function toGid(numericId) {
  return `gid://shopify/Customer/${numericId}`;
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (!verifySignature(url.searchParams)) {
    return htmlResponse(page("Error", `<p class="alert alert-error">Invalid request. Please access this page through the store.</p>`));
  }

  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId || customerId === "0") {
    return htmlResponse(page("Your upcoming orders", `
      <div class="card" style="text-align:center;padding:3rem">
        <p>Please <a href="/account/login?return_url=/apps/standing-orders">sign in to your account</a> to view your upcoming orders.</p>
      </div>
    `));
  }

  const shopifyCustomerId = toGid(customerId);
  const records = await prisma.draftOrderRecord.findMany({
    where: { status: "open", standingOrder: { shopifyCustomerId } },
    include: { standingOrder: true, items: true },
    orderBy: { deliveryDate: "asc" },
  });

  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const { admin } = await unauthenticated.admin(shop);

  const orders = await Promise.all(
    records.map(async (record) => {
      const details = await getDraftOrderDetails(admin, record.shopifyDraftOrderId);
      const minimums = Object.fromEntries(
        record.items.map((i) => [i.shopifyVariantId, { min: i.minimumQuantity, isStanding: i.isStandingItem }])
      );
      const lineItems = (details?.lineItems?.edges || []).map(({ node }) => ({
        id: node.id,
        title: node.title,
        variantTitle: node.variant?.title !== "Default Title" ? node.variant?.title ?? "" : "",
        variantId: node.variant?.id ?? null,
        price: parseFloat(node.originalUnitPrice || 0),
        quantity: node.quantity,
        min: node.variant?.id ? (minimums[node.variant.id]?.min ?? 0) : 0,
        isStanding: node.variant?.id ? (minimums[node.variant.id]?.isStanding ?? false) : false,
      }));
      return {
        id: record.id,
        name: record.shopifyDraftOrderName || `#${record.id}`,
        deliveryDate: record.deliveryDate,
        closeDay: record.standingOrder.closeDay,
        standingOrderName: record.standingOrder.name,
        lineItems,
      };
    })
  );

  const successId = url.searchParams.get("updated");

  const cardsHtml = orders.length === 0
    ? `<div class="card" style="text-align:center;padding:3rem;color:#6d7175">
        <p>No upcoming orders right now.</p>
        <p style="margin-top:.5rem;font-size:.875rem">Your standing order will appear here each week before your delivery date.</p>
       </div>`
    : orders.map((order) => orderCard(order, successId)).join("");

  return htmlResponse(page("Your upcoming orders", cardsHtml));
};

export const action = async ({ request }) => {
  const url = new URL(request.url);

  if (!verifySignature(url.searchParams)) {
    return htmlResponse(page("Error", `<p class="alert alert-error">Invalid request.</p>`));
  }

  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId || customerId === "0") {
    return new Response(null, { status: 302, headers: { Location: "/account/login?return_url=/apps/standing-orders" } });
  }

  const formData = await request.formData();
  const recordId = formData.get("recordId");
  const lineItemsJson = formData.get("lineItems");

  let lineItems;
  try { lineItems = JSON.parse(lineItemsJson); } catch {
    return new Response(null, { status: 302, headers: { Location: "/apps/standing-orders?error=invalid" } });
  }

  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const { admin } = await unauthenticated.admin(shop);

  try {
    await applyCustomerDraftOrderUpdate(admin, recordId, lineItems);
  } catch {
    return new Response(null, { status: 302, headers: { Location: `/apps/standing-orders?error=1` } });
  }

  return new Response(null, { status: 302, headers: { Location: `/apps/standing-orders?updated=${recordId}` } });
};

// ── HTML helpers ────────────────────────────────────────────────────────────

function orderCard(order, successId) {
  const subtotal = order.lineItems.reduce((s, l) => s + l.price * l.quantity, 0);
  const lineItemsJson = JSON.stringify(
    order.lineItems.filter(l => l.variantId).map(l => ({ variantId: l.variantId, quantity: l.quantity }))
  ).replace(/"/g, "&quot;");

  const rows = order.lineItems.map((line, idx) => `
    <tr>
      <td>
        <div style="font-weight:500">${escHtml(line.title)}</div>
        ${line.variantTitle ? `<div style="color:#6d7175;font-size:.8125rem">${escHtml(line.variantTitle)}</div>` : ""}
        ${line.isStanding ? `<span class="badge badge-standing">Standing item</span>` : ""}
      </td>
      <td>
        <input class="qty-input" type="number" name="qty_${idx}"
          min="${line.isStanding ? line.min : 1}"
          value="${line.quantity}"
          data-variantid="${escHtml(line.variantId ?? "")}"
          data-min="${line.isStanding ? line.min : 1}"
          data-standing="${line.isStanding ? "1" : "0"}"
          ${line.isStanding ? `title="Minimum ${line.min}"` : ""}
        />
        ${line.isStanding ? `<div style="font-size:.75rem;color:#6d7175">min ${line.min}</div>` : ""}
      </td>
      <td style="text-align:right">$${(line.price * line.quantity).toFixed(2)}</td>
    </tr>`).join("");

  const successBanner = String(successId) === String(order.id)
    ? `<div class="alert alert-success">Order updated successfully.</div>` : "";

  return `
    <div class="card">
      <div class="order-meta">
        <span>${escHtml(order.name)}</span>
        <span>Delivery: <strong>${order.deliveryDate}</strong></span>
        <span>Deadline: <strong>${DAY_NAMES[order.closeDay]}</strong></span>
      </div>
      ${successBanner}
      <form method="POST" onsubmit="return validateOrder(this)">
        <input type="hidden" name="recordId" value="${order.id}" />
        <input type="hidden" name="lineItems" id="lineItems_${order.id}" value="${lineItemsJson}" />
        <table>
          <thead><tr><th>Product</th><th style="width:100px">Qty</th><th style="text-align:right;width:110px">Line total</th></tr></thead>
          <tbody id="tbody_${order.id}">${rows}</tbody>
          <tfoot><tr>
            <td colspan="2" style="text-align:right">Subtotal</td>
            <td style="text-align:right" id="subtotal_${order.id}">$${subtotal.toFixed(2)}</td>
          </tr></tfoot>
        </table>
        <div class="actions-row">
          <button type="submit" class="btn btn-primary">Save changes</button>
        </div>
      </form>
    </div>`;
}

function page(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(title)}</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="portal-header">
    <h1>${escHtml(title)}</h1>
    <a href="/account" style="font-size:.875rem;color:#008060;text-decoration:none">← My account</a>
  </header>
  <div class="portal-container">
    ${content}
  </div>
  <script>
    function validateOrder(form) {
      const inputs = form.querySelectorAll('.qty-input');
      const items = [];
      for (const input of inputs) {
        const qty = parseInt(input.value, 10);
        const min = parseInt(input.dataset.min, 10);
        if (isNaN(qty) || qty < 1) { alert('Please enter a valid quantity.'); input.focus(); return false; }
        if (input.dataset.standing === '1' && qty < min) {
          alert('Quantity for this standing order item cannot go below ' + min + '.'); input.focus(); return false;
        }
        if (input.dataset.variantid) items.push({ variantId: input.dataset.variantid, quantity: qty });
      }
      form.querySelector('[name="lineItems"]').value = JSON.stringify(items);
      return true;
    }
  </script>
</body>
</html>`;
}

function escHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function htmlResponse(html) {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f6f7;color:#1a1a1a;min-height:100vh}
.portal-header{background:#fff;border-bottom:1px solid #e1e3e5;padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center}
.portal-header h1{font-size:1.125rem;font-weight:600}
.portal-container{max-width:860px;margin:2rem auto;padding:0 1.5rem}
.card{background:#fff;border:1px solid #e1e3e5;border-radius:8px;padding:1.5rem;margin-bottom:1.5rem}
.alert{padding:.75rem 1rem;border-radius:4px;margin-bottom:1rem;font-size:.875rem}
.alert-error{background:#fff4f4;border:1px solid #ffd2cc;color:#d72c0d}
.alert-success{background:#f1f8f5;border:1px solid #95c9b4;color:#0d3b2e}
table{width:100%;border-collapse:collapse;font-size:.875rem}
thead th{text-align:left;padding:.5rem .75rem;background:#f6f6f7;border-bottom:1px solid #e1e3e5;font-weight:500;color:#6d7175;font-size:.8125rem}
tbody td{padding:.75rem;border-bottom:1px solid #e1e3e5;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tfoot td{padding:.75rem;font-weight:600}
.qty-input{width:72px;padding:.375rem .5rem;border:1px solid #8c9196;border-radius:4px;font-size:.875rem;text-align:center}
.badge{display:inline-block;padding:.125rem .5rem;border-radius:10px;font-size:.75rem;font-weight:500}
.badge-standing{background:#e3f1df;color:#0d3b2e}
.order-meta{display:flex;gap:1.5rem;color:#6d7175;font-size:.875rem;margin-bottom:1rem;flex-wrap:wrap}
.order-meta strong{color:#1a1a1a}
.actions-row{display:flex;justify-content:flex-end;margin-top:1rem}
.btn{display:inline-flex;align-items:center;padding:.5rem 1.125rem;border-radius:4px;font-size:.875rem;font-weight:500;cursor:pointer;border:1px solid transparent}
.btn-primary{background:#008060;color:#fff}
.btn-primary:hover{background:#006e52}
`;
