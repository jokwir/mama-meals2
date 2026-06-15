# Mama Meals

Mama Meals is a mobile-friendly HTML prototype for a Kenyan food delivery platform. It is structured so the main screens, data model, and styling can later be converted into a Flutter app with minimal guesswork.

## Purpose

The project demonstrates the customer-facing flow for ordering local meals from home kitchens and vendors. It includes browsing meals, adding items to a cart, checkout, application pages for riders and cooks, and customer support.

## Project Structure

```text
mama-meals/
  index.html                 Home page with vendor search, filters, categories, promo slideshow, and shop links
  cart.html                  Cart and checkout page with quantities, payment choice, and confirmation
  shop.html                  Vendor shop/menu page with meals, sides, drinks, snacks, and add-to-cart buttons
  order-history.html         Customer order list with reorder/review/test status controls
  order-tracking.html        Static-ready tracking page with status steps and map placeholder
  account.html               Customer account, roles, saved details, team links, and dashboard access
  admin-dashboard.html       Protected admin dashboard placeholder
  vendor-dashboard.html      Protected vendor dashboard placeholder
  rider-dashboard.html       Protected rider dashboard placeholder
  apply-rider.html           Rider application form
  apply-cook.html            Cook/vendor application form
  contact.html               Customer support form and WhatsApp link
  config.json                Shared brand, pricing, contact, and API placeholder settings
  assets/
    css/
      style.css              Shared responsive styling for all pages
    js/
      app.js                 Cart storage, filtering, slideshow, checkout, and confirmation logic
  scripts/
    build-production.js      Creates the minified production dist folder
    check-links.js           Verifies internal HTML links and assets
  images/
    01_bibis_traditional_meals.png
    02_chapati_spot.png
    03_mama_sarahs_kitchen.png
    04_nairobi_delights.png
    05_free_fast_delivery.png
    06_join_the_team_rider.png
```

## Current Features

- Mobile-first home page using Mama Meals brand colors.
- Delivery location header, search field, and horizontal meal categories.
- Promo slideshow for delivery and rider recruitment.
- Featured vendor cards with image, description, delivery time, and price. Tapping a card opens the full shop/menu page.
- Horizontal filter rail for pickup-only, offers, delivery fee, delivery time, rating, price, and sorting.
- Icon-only mobile bottom navigation for Home, Orders, and Account.
- Notification bell placeholder for future promotions and alerts.
- Persistent cart stored in browser `localStorage`.
- Cart and checkout page with item quantities, subtotal, delivery fee, total, address, instructions, and payment method.
- Placeholder M-Pesa Daraja integration area.
- Rider, cook/vendor, and support forms.
- WhatsApp contact link using the configured support number.

## Configuration

Core project settings live in `config.json`.

Use this file as the future source of truth for:

- Brand colors
- Delivery fee and default item prices
- Contact details
- Vendor metadata
- API integration placeholders

JSON does not support comments, so explanatory notes are kept here instead of inside `config.json`.

## Flutter Conversion Notes

The prototype is already split into screens and reusable concepts that map naturally into Flutter:

- `index.html` can become a `HomeScreen`.
- `cart.html` can become a `CartCheckoutScreen`.
- `apply-rider.html`, `apply-cook.html`, and `contact.html` can become separate form screens.
- `assets/js/app.js` shows the temporary state model for cart items: `name`, `price`, `image`, and `quantity`.
- `config.json` can become a Dart config class, remote config document, or seeded backend data.
- CSS color variables map directly to Flutter theme constants.

## Code Comments And Maintainability

The app is intentionally organized with clear class names and separated files:

- HTML files hold page structure and form fields.
- `style.css` groups styling by feature area.
- `app.js` groups behavior into small functions for cart storage, totals, filtering, slideshow, and checkout.

When converting to Flutter, keep those same boundaries: screens for pages, widgets for repeated UI, models for cart/vendor data, and services for payments/contact APIs.

## Future Plans

- Replace browser-only `localStorage` cart storage with a real account/cart backend.
- Connect M-Pesa Daraja STK push for live payments.
- Add rider and cook/vendor application submission endpoints.
- Add order tracking and order history.
- Add user login and saved addresses.
- Add admin tools for vendors, menus, pricing, and order management.
- Add Flutter mobile app using this prototype as the product reference.

## Production Build

Run these checks before hosting:

```bash
npm run check
npm run build
```

The build command creates `dist/` with:

- Minified `assets/css/style.min.css`
- Minified `assets/js/app.min.js`
- HTML files updated to use the minified assets
- Images copied with their original names
- Firebase and hosting templates copied for deployment reference

Image files are currently copied as-is to preserve the exact filenames and visual quality. Before a real production launch, compress the PNG files with a local image tool such as `sharp`, `pngquant`, or an equivalent design export pipeline, then keep the same filenames.

## Environment Variables

Use `.env.production.example` as the production checklist. Do not commit real private server credentials.

Required public Firebase values:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

Daraja/M-Pesa secrets must live in a secure backend or cloud function, not in the static frontend.

## Firebase Production Checklist

Before deploying live data:

- Replace placeholder Firebase config with production project values.
- Confirm Firebase Auth email/password is enabled.
- Require email verification before sensitive account actions.
- Deploy Firestore and Storage security rules.
- Verify role-based access for customer, vendor, rider, and admin accounts.
- Confirm emulator/test mode is off for production.

## Hosting Steps

1. Update `.env.production.example` values in the hosting provider settings.
2. Run `npm run check`.
3. Run `npm run build`.
4. Deploy the contents of `dist/` to Firebase Hosting, Netlify, or another static host.
5. After deployment, test Home, Shop, Cart, Checkout, Account, Orders, Tracking, Admin, Vendor, and Rider routes on a mobile screen.
