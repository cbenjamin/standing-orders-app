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

export async function createDraftOrder(admin, { customerId, lineItems, note, tags }) {
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
          })),
          note,
          tags,
          shippingLine: { title: "Delivery", price: "5.00" },
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

export async function createOrderFromDraft(admin, draftOrderId, { tags = [], note = "" } = {}) {
  // Fetch final line items from the draft order
  const draft = await getDraftOrderDetails(admin, draftOrderId);
  if (!draft) throw new Error(`Draft order ${draftOrderId} not found`);

  const lineItems = draft.lineItems.edges.map(({ node }) => ({
    variantId: node.variant?.id,
    quantity: node.quantity,
    title: node.title,
    originalUnitPrice: node.originalUnitPrice,
  })).filter((li) => li.variantId); // skip custom lines without a variant

  const response = await admin.graphql(
    `#graphql
    mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        order { id name }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        order: {
          customerId: draft.customer?.id,
          lineItems: lineItems.map((li) => ({
            variantId: li.variantId,
            quantity: li.quantity,
          })),
          financialStatus: "PENDING",
          note,
          tags,
          shippingLines: [{
            title: "Delivery",
            priceSet: { shopMoney: { amount: "5.00", currencyCode: "USD" } },
          }],
        },
        options: { sendReceipt: false },
      },
    },
  );
  const json = await response.json();
  const { order, userErrors } = json.data.orderCreate;
  if (userErrors?.length) throw new Error(userErrors.map((e) => e.message).join(", "));

  // Delete the draft order now that we've created the real order
  await admin.graphql(
    `#graphql
    mutation DraftOrderDelete($id: ID!) {
      draftOrderDelete(input: { id: $id }) {
        deletedId
        userErrors { field message }
      }
    }`,
    { variables: { id: draftOrderId } },
  );

  return order;
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
              id title quantity originalUnitPrice
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
