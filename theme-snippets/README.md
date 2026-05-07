# Theme Snippets

These files live **outside** the React app and are manually copied into the store's Shopify theme.

---

## `standing-order-banner.liquid`

Displays a slim green banner at the top of every storefront page when a logged-in customer has an open standing order ready for review.

### Installation

1. In the Shopify admin go to **Online Store → Themes → your active theme → Edit code**.
2. Under **Snippets**, click **Add a new snippet**, name it `standing-order-banner`, and paste in the file contents.
3. Open `layout/theme.liquid` and add the render tag once, right before the closing `</body>` tag:
   ```liquid
   {% render 'standing-order-banner' %}
   ```
4. Save and preview.

### Behaviour

- Only rendered for logged-in customers (`{% if customer %}`).
- Makes one lightweight `GET /apps/standing-orders?intent=check` fetch (Shopify automatically appends `logged_in_customer_id`).
- If the customer has ≥ 1 open draft order, the banner becomes visible.
- The customer can dismiss the banner; it stays hidden for the rest of the browser session via `sessionStorage`.
- Fully silent on any network error — the banner simply stays hidden.

### Customisation

Edit the `<style>` block at the bottom of the snippet. Key variables:

| CSS selector | What it controls |
|---|---|
| `#so-banner` | Background colour + border |
| `.so-banner__message` | Body text colour |
| `.so-banner__link` | Link colour |
