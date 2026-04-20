import prisma from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { getDraftOrderDetails } from "../services/shopify-graphql.server";
import { applyCustomerDraftOrderUpdate } from "../services/draft-orders.server";
import { searchStorefrontProducts } from "../services/shopify-storefront.server";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toGid(numericId) {
  return `gid://shopify/Customer/${numericId}`;
}

export const loader = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);
  } catch {
    return htmlResponse(page("Error", `<p class="alert alert-error">Invalid request. Please access this page through the store.</p>`));
  }

  const url = new URL(request.url);
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
  try {
    await authenticate.public.appProxy(request);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "search-products") {
    const q = formData.get("q") || "";
    const results = await searchStorefrontProducts(q);
    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // update-order
  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId || customerId === "0") {
    return new Response(null, { status: 302, headers: { Location: "/account/login?return_url=/apps/standing-orders" } });
  }

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
  } catch (err) {
    console.error("[proxy] update failed:", err.message);
    return new Response(null, { status: 302, headers: { Location: `/apps/standing-orders?error=1` } });
  }

  return new Response(null, { status: 302, headers: { Location: `/apps/standing-orders?updated=${recordId}` } });
};

// ── HTML helpers ─────────────────────────────────────────────────────────────

function orderCard(order, successId) {
  const itemsJson = escHtml(JSON.stringify(order.lineItems));
  const successBanner = String(successId) === String(order.id)
    ? `<div class="alert alert-success">Order updated successfully.</div>` : "";

  return `
    <div class="card" id="card-${order.id}">
      <div class="order-meta">
        <span>${escHtml(order.name)}</span>
        <span>Delivery: <strong>${order.deliveryDate}</strong></span>
        <span>Deadline: <strong>${DAY_NAMES[order.closeDay]}</strong></span>
      </div>
      ${successBanner}
      <form method="POST" onsubmit="return submitOrder(event, ${order.id})">
        <input type="hidden" name="intent" value="update-order" />
        <input type="hidden" name="recordId" value="${order.id}" />
        <input type="hidden" name="lineItems" id="li-${order.id}" value="[]" />
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th style="width:110px">Qty</th>
              <th style="text-align:right;width:110px">Line total</th>
              <th style="width:60px"></th>
            </tr>
          </thead>
          <tbody id="tbody-${order.id}"></tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align:right">Subtotal</td>
              <td style="text-align:right;font-weight:600" id="subtotal-${order.id}">$0.00</td>
            </tr>
          </tfoot>
        </table>

        <div class="add-item-wrap" style="margin-top:1rem;position:relative">
          <input
            type="text"
            class="search-input"
            placeholder="Search to add a product…"
            autocomplete="off"
            oninput="handleSearch(event, ${order.id})"
            onfocus="handleSearch(event, ${order.id})"
          />
          <div class="search-dropdown" id="dropdown-${order.id}" style="display:none"></div>
        </div>

        <div class="actions-row">
          <button type="submit" class="btn btn-primary">Save changes</button>
        </div>
      </form>
    </div>
    <script>initCard(${order.id}, JSON.parse('${itemsJson.replace(/'/g, "\\'")}'));</script>`;
}

function page(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(title)}</title>
  <style>${CSS}</style>
<script>
var cardState = {};
var searchTimers = {};

function initCard(recordId, items) {
  cardState[recordId] = items.map(function(i) { return Object.assign({}, i); });
  renderTable(recordId);
}

function renderTable(recordId) {
  var items = cardState[recordId];
  var tbody = document.getElementById('tbody-' + recordId);
  var subtotalEl = document.getElementById('subtotal-' + recordId);
  var liInput = document.getElementById('li-' + recordId);
  if (!tbody) return;

  var subtotal = 0;
  tbody.innerHTML = items.map(function(item, idx) {
    subtotal += item.price * item.quantity;
    var minQty = item.isStanding ? item.min : 1;
    var removeBtn = item.isStanding ? '' :
      '<button type="button" class="btn-remove" onclick="removeItem(' + recordId + ',\\'' + item.variantId + '\\')">Remove</button>';
    return '<tr>' +
      '<td><div style="font-weight:500">' + esc(item.title) + '</div>' +
        (item.variantTitle ? '<div style="color:#6d7175;font-size:.8125rem">' + esc(item.variantTitle) + '</div>' : '') +
        (item.isStanding ? '<span class="badge badge-standing">Standing item</span>' : '') +
      '</td>' +
      '<td>' +
        '<input class="qty-input" type="number" min="' + minQty + '" value="' + item.quantity + '" ' +
          'onchange="updateQty(' + recordId + ',\\'' + item.variantId + '\\', this.value)" />' +
        (item.isStanding ? '<div style="font-size:.75rem;color:#6d7175">min ' + item.min + '</div>' : '') +
      '</td>' +
      '<td style="text-align:right">$' + (item.price * item.quantity).toFixed(2) + '</td>' +
      '<td>' + removeBtn + '</td>' +
    '</tr>';
  }).join('');

  subtotalEl.textContent = '$' + subtotal.toFixed(2);
  liInput.value = JSON.stringify(
    items.filter(function(i) { return i.variantId; })
         .map(function(i) { return { variantId: i.variantId, quantity: i.quantity }; })
  );
}

function updateQty(recordId, variantId, val) {
  var qty = parseInt(val, 10);
  var items = cardState[recordId];
  var item = items.find(function(i) { return i.variantId === variantId; });
  if (!item) return;
  var min = item.isStanding ? item.min : 1;
  item.quantity = Math.max(min, isNaN(qty) ? min : qty);
  renderTable(recordId);
}

function removeItem(recordId, variantId) {
  cardState[recordId] = cardState[recordId].filter(function(i) { return i.variantId !== variantId; });
  renderTable(recordId);
}

function addItem(recordId, item) {
  var items = cardState[recordId];
  if (items.some(function(i) { return i.variantId === item.variantId; })) return;
  items.push({ title: item.title, variantTitle: item.variantTitle, variantId: item.variantId,
    price: item.price, quantity: 1, isStanding: false, min: 0 });
  renderTable(recordId);
  var dropdown = document.getElementById('dropdown-' + recordId);
  var input = dropdown.previousElementSibling;
  dropdown.style.display = 'none';
  input.value = '';
}

var searchCache = {};
function handleSearch(event, recordId) {
  var q = event.target.value.trim();
  var dropdown = document.getElementById('dropdown-' + recordId);
  if (q.length < 2) { dropdown.style.display = 'none'; return; }
  clearTimeout(searchTimers[recordId]);
  searchTimers[recordId] = setTimeout(function() {
    if (searchCache[q]) { showResults(recordId, searchCache[q]); return; }
    var fd = new FormData();
    fd.append('intent', 'search-products');
    fd.append('q', q);
    fetch(window.location.pathname + window.location.search, { method: 'POST', body: fd })
      .then(function(r) { return r.json(); })
      .then(function(results) {
        searchCache[q] = results;
        showResults(recordId, results);
      });
  }, 300);
}

function showResults(recordId, products) {
  var dropdown = document.getElementById('dropdown-' + recordId);
  var items = [];
  products.forEach(function(p) {
    (p.variants || []).forEach(function(v) {
      var price = v.price && v.price.amount ? v.price.amount : v.price;
      items.push({ title: p.title, variantTitle: v.title !== 'Default Title' ? v.title : '',
        variantId: v.id, price: parseFloat(price || 0) });
    });
  });
  if (!items.length) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = items.map(function(item) {
    var label = esc(item.title) + (item.variantTitle ? ' &mdash; ' + esc(item.variantTitle) : '') +
      ' <span style="color:#6d7175">$' + item.price.toFixed(2) + '</span>';
    return '<div class="search-result" onclick="addItem(' + recordId + ',' + JSON.stringify(item).replace(/"/g, '&quot;') + ')">' + label + '</div>';
  }).join('');
  dropdown.style.display = 'block';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function submitOrder(event, recordId) {
  var items = cardState[recordId];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.isStanding && item.quantity < item.min) {
      alert('Quantity for "' + item.title + '" cannot go below ' + item.min + '.');
      event.preventDefault(); return false;
    }
  }
  return true;
}

document.addEventListener('click', function(e) {
  if (!e.target.classList.contains('search-input')) {
    document.querySelectorAll('.search-dropdown').forEach(function(d) { d.style.display = 'none'; });
  }
});
</script>
</head>
<body>
  <header class="portal-header">
    <h1>${escHtml(title)}</h1>
    <a href="/account" style="font-size:.875rem;color:#008060;text-decoration:none">← My account</a>
  </header>
  <div class="portal-container">
    ${content}
  </div>
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
tfoot td{padding:.75rem}
.qty-input{width:72px;padding:.375rem .5rem;border:1px solid #8c9196;border-radius:4px;font-size:.875rem;text-align:center}
.badge{display:inline-block;padding:.125rem .5rem;border-radius:10px;font-size:.75rem;font-weight:500}
.badge-standing{background:#e3f1df;color:#0d3b2e}
.order-meta{display:flex;gap:1.5rem;color:#6d7175;font-size:.875rem;margin-bottom:1rem;flex-wrap:wrap}
.order-meta strong{color:#1a1a1a}
.actions-row{display:flex;justify-content:flex-end;margin-top:1rem}
.btn{display:inline-flex;align-items:center;padding:.5rem 1.125rem;border-radius:4px;font-size:.875rem;font-weight:500;cursor:pointer;border:1px solid transparent}
.btn-primary{background:#008060;color:#fff}
.btn-primary:hover{background:#006e52}
.btn-remove{background:none;border:none;color:#d72c0d;font-size:.8125rem;cursor:pointer;padding:.25rem .5rem}
.btn-remove:hover{text-decoration:underline}
.search-input{width:100%;padding:.5rem .75rem;border:1px solid #8c9196;border-radius:4px;font-size:.875rem}
.search-dropdown{position:absolute;top:100%;left:0;width:100%;background:#fff;border:1px solid #e1e3e5;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;z-index:100}
.search-result{padding:.5rem .75rem;cursor:pointer;font-size:.875rem;border-bottom:1px solid #f6f6f7}
.search-result:hover{background:#f6f6f7}
.search-result:last-child{border-bottom:none}
`;
