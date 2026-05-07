// Each function accepts an `admin` client from either
// authenticate.admin(request) or unauthenticated.admin(shop)

export async function searchCustomers(admin, query) {
  const response = await admin.graphql(
    `#graphql
    query SearchCustomers($query: String!) {
      customers(first: 10, query: $query) {
        edges {
          node { id displayName email phone }
        }
      }
    }`,
    { variables: { query } },
  );
  const json = await response.json();
  return json.data.customers.edges.map((e) => e.node);
}

export async function searchProducts(admin, query) {
  const response = await admin.graphql(
    `#graphql
    query SearchProducts($query: String!) {
      products(first: 20, query: $query) {
        edges {
          node {
            id title
            variants(first: 10) {
              edges {
                node { id title price sku }
              }
            }
          }
        }
      }
    }`,
    { variables: { query } },
  );
  const json = await response.json();
  return json.data.products.edges.map((e) => ({
    id: e.node.id,
    title: e.node.title,
    variants: e.node.variants.edges.map((v) => v.node),
  }));
}

export async function getVariantPrices(admin, variantIds) {
  const response = await admin.graphql(
    `#graphql
    query GetVariantPrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          price
        }
      }
    }`,
    { variables: { ids: variantIds } },
  );
  const json = await response.json();
  const priceMap = {};
  for (const node of json.data.nodes) {
    if (node?.id) priceMap[node.id] = node.price;
  }
  return priceMap;
}

async function getCustomerDefaultAddress(admin, customerId) {
  const response = await admin.graphql(
    `#graphql
    query GetCustomerAddress($id: ID!) {
      customer(id: $id) {
        defaultAddress {
          firstName lastName company
          address1 address2
          city province zip
          countryCodeV2
          phone
        }
      }
    }`,
    { variables: { id: customerId } },
  );
  const json = await response.json();
  return json.data?.customer?.defaultAddress ?? null;
}

export async function createDraftOrder(admin, { customerId, lineItems, note, tags }) {
  // Fetch customer's default address so draftOrderComplete can succeed
  // (Shopify requires a shipping address when a shippingLine is present)
  const defaultAddress = await getCustomerDefaultAddress(admin, customerId);

  const shippingAddress = defaultAddress
    ? {
        firstName: defaultAddress.firstName,
        lastName: defaultAddress.lastName,
        company: defaultAddress.company,
        address1: defaultAddress.address1,
        address2: defaultAddress.address2,
        city: defaultAddress.city,
        province: defaultAddress.province,
        zip: defaultAddress.zip,
        countryCode: defaultAddress.countryCodeV2,
        phone: defaultAddress.phone,
      }
    : undefined;

  const response = await admin.graphql(
    `#graphql
    mutation DraftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id name invoiceUrl }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          customerId,
          lineItems: lineItems.map((li) => ({
            variantId: li.variantId,
            quantity: li.quantity,
            ...(li.appliedDiscount ? { appliedDiscount: li.appliedDiscount } : {}),
          })),
          note,
          tags,
          shippingLine: { title: "Delivery", price: "5.00" },
          ...(shippingAddress ? { shippingAddress } : {}),
        },
      },
    },
  );
  const json = await response.json();
  const { draftOrder, userErrors } = json.data.draftOrderCreate;
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join(", "));
  return draftOrder;
}

export async function updateDraftOrder(admin, { draftOrderId, lineItems }) {
  const response = await admin.graphql(
    `#graphql
    mutation DraftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
      draftOrderUpdate(id: $id, input: $input) {
        draftOrder {
          id name
          lineItems(first: 50) {
            edges {
              node {
                id title quantity originalUnitPrice
                variant { id title }
                product { id title }
              }
            }
          }
          subtotalPrice totalPrice
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        id: draftOrderId,
        input: {
          lineItems: lineItems.map((li) => ({
            variantId: li.variantId,
            quantity: li.quantity,
            ...(li.appliedDiscount ? { appliedDiscount: li.appliedDiscount } : {}),
          })),
        },
      },
    },
  );
  const json = await response.json();
  const { draftOrder, userErrors } = json.data.draftOrderUpdate;
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join(", "));
  return draftOrder;
}

export async function createOrderFromDraft(admin, draftOrderId) {
  // draftOrderComplete(paymentPending: true) creates the order in a payment-pending
  // state (equivalent to "pay on fulfillment / net terms") while preserving all
  // draft data: line items, discounts, tags, note, and shipping address.
  // Crucially, orders created this way remain editable in the Shopify admin —
  // unlike orders created via the orderCreate mutation with paymentTermsCreate,
  // which Shopify locks from editing.
  const response = await admin.graphql(
    `#graphql
    mutation DraftOrderComplete($id: ID!) {
      draftOrderComplete(id: $id, paymentPending: true) {
        draftOrder {
          id
          order { id name }
        }
        userErrors { field message }
      }
    }`,
    { variables: { id: draftOrderId } },
  );
  const json = await response.json();
  const { draftOrder, userErrors } = json.data.draftOrderComplete;
  if (userErrors?.length) throw new Error(userErrors.map((e) => e.message).join(", "));
  return draftOrder?.order ?? null;
}

export async function completeDraftOrder(admin, draftOrderId) {
  const response = await admin.graphql(
    `#graphql
    mutation DraftOrderComplete($id: ID!) {
      draftOrderComplete(id: $id, paymentPending: true) {
        draftOrder { id order { id name } }
        userErrors { field message }
      }
    }`,
    { variables: { id: draftOrderId } },
  );
  const json = await response.json();
  const { draftOrder, userErrors } = json.data.draftOrderComplete;
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join(", "));
  return draftOrder;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function sendDraftOrderEmail(admin, draftOrderId, { subject, customMessage }) {
  const response = await admin.graphql(
    `#graphql
    mutation DraftOrderInvoiceSend($id: ID!, $email: EmailInput) {
      draftOrderInvoiceSend(id: $id, email: $email) {
        draftOrder { id }
        userErrors { field message }
      }
    }`,
    { variables: { id: draftOrderId, email: { subject, customMessage } } },
  );
  const json = await response.json();
  const { userErrors } = json.data.draftOrderInvoiceSend;
  if (userErrors?.length) throw new Error(userErrors.map((e) => e.message).join(", "));
}

function fmtDate(dateStr) {
  if (!dateStr) return dateStr;
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

export async function sendDraftOrderCreationEmail(admin, draftOrderId, { closeTime, closeDay, deliveryDate }) {
  const dayName = DAY_NAMES[closeDay] || "the deadline day";
  await sendDraftOrderEmail(admin, draftOrderId, {
    subject: `Your standing order for ${fmtDate(deliveryDate)} is ready — add items before ${closeTime} EST on ${dayName}`,
    customMessage: `Your next standing order is now available. You can add items or update quantities until ${closeTime} EST on ${dayName}.`,
  });
}

export async function sendDraftOrderReminderEmail(admin, draftOrderId, { closeTime, deliveryDate }) {
  await sendDraftOrderEmail(admin, draftOrderId, {
    subject: `Your standing order for ${fmtDate(deliveryDate)} — add items before ${closeTime} EST tomorrow`,
    customMessage: `It's not too late to add to your upcoming standing order! You have until ${closeTime} EST tomorrow to review and add items to this week's delivery.`,
  });
}

export async function getDraftOrderDetails(admin, draftOrderId) {
  const response = await admin.graphql(
    `#graphql
    query GetDraftOrder($id: ID!) {
      draftOrder(id: $id) {
        id name status invoiceUrl
        customer { id }
        lineItems(first: 50) {
          edges {
            node {
              id title quantity originalUnitPrice discountedUnitPrice
              variant { id title image { url } }
              product { id title }
            }
          }
        }
        subtotalPrice totalPrice
      }
    }`,
    { variables: { id: draftOrderId } },
  );
  const json = await response.json();
  return json.data.draftOrder;
}
