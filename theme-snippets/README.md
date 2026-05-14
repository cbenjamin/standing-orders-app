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

---

## `standing-order-cart-intercept.liquid`

When a logged-in customer who has an open standing order clicks **Add to Cart** on any product page, shows a modal dialog prompting them to add to their standing order instead. The customer can choose to go to their standing order or proceed with the cart add.

### Installation

1. In the Shopify admin go to **Online Store → Themes → your active theme → Edit code**.
2. Under **Snippets**, click **Add a new snippet**, name it `standing-order-cart-intercept`, and paste in the file contents.
3. Open `layout/theme.liquid` and add the render tag **directly below** the banner render tag:
   ```liquid
   {% render 'standing-order-banner' %}
   {% render 'standing-order-cart-intercept' %}
   ```
4. Save and preview.

### Behaviour

- Only rendered for logged-in customers (`{% if customer %}`).
- Pre-fetches `/apps/standing-orders?intent=check` on page load and caches the result in `sessionStorage` for 5 minutes — no extra requests on repeat page views.
- Intercepts clicks on add-to-cart buttons (`[name="add"]` and submit buttons inside `form[action*="/cart/add"]`) using a capture-phase listener.
- **If** the customer has an open draft order: shows the modal with two choices.
  - **"Add to my standing order"** → navigates to `/apps/standing-orders`
  - **"Add to cart instead"** → re-fires the original button click so the theme's normal cart logic (AJAX, mini-cart updates, etc.) runs as usual
  - **× / backdrop / Escape** → dismisses without adding to cart
- **If** the check hasn't resolved yet when the customer clicks (rare): lets the click through immediately with no interruption.

### Customisation

Edit the `<style>` block inside the snippet. Key selectors:

| CSS selector | What it controls |
|---|---|
| `.so-intercept__card` | Modal card background, border-radius, shadow |
| `.so-intercept__heading` | Dialog title colour |
| `.so-intercept__btn--primary` | "Add to standing order" button colour |
| `.so-intercept__btn--secondary` | "Add to cart instead" button style |
