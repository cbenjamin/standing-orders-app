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
