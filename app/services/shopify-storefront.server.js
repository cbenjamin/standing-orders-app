const STOREFRONT_URL = `https://${process.env.SHOPIFY_STORE_DOMAIN}/api/2025-01/graphql.json`;

async function storefrontFetch(query, variables = {}) {
  const res = await fetch(STOREFRONT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": process.env.SHOPIFY_STOREFRONT_TOKEN || "",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Storefront API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

export async function customerLogin(email, password) {
  const data = await storefrontFetch(
    `mutation CustomerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
      customerAccessTokenCreate(input: $input) {
        customerAccessToken { accessToken expiresAt }
        customerUserErrors { code message }
      }
    }`,
    { input: { email, password } },
  );
  const { customerAccessToken, customerUserErrors } = data.customerAccessTokenCreate;
  if (customerUserErrors.length) throw new Error(customerUserErrors[0].message);
  return customerAccessToken;
}

export async function getCustomerByToken(accessToken) {
  const data = await storefrontFetch(
    `query GetCustomer($customerAccessToken: String!) {
      customer(customerAccessToken: $customerAccessToken) {
        id email displayName firstName lastName
      }
    }`,
    { customerAccessToken: accessToken },
  );
  return data.customer;
}

export async function searchStorefrontProducts(query) {
  const data = await storefrontFetch(
    `query SearchProducts($query: String!) {
      products(first: 20, query: $query) {
        edges {
          node {
            id title
            variants(first: 10) {
              edges {
                node {
                  id title availableForSale
                  price { amount currencyCode }
                  image { url altText }
                }
              }
            }
          }
        }
      }
    }`,
    { query },
  );
  return data.products.edges.map((e) => ({
    id: e.node.id,
    title: e.node.title,
    variants: e.node.variants.edges.map((v) => v.node),
  }));
}
