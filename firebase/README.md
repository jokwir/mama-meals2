# Mama Meals Firebase Setup Placeholder

This folder prepares the project for Firebase integration without connecting live data yet.

## Included

- `firebase-config.placeholder.js`: frontend config shape for the Firebase Web SDK.
- `firestore.rules`: security rules template for users, vendors, riders, orders, menu items, and applications.
- `firestore.indexes.json`: starter indexes for common order/menu queries.
- `storage.rules`: storage bucket rules template for profile, vendor, menu, rider, and application images.
- `collections.schema.json`: planned Firestore collections and fields.
- `auth.rules.md`: authentication and role rules plan.

## Planned Collections

- `users`
- `vendors`
- `riders`
- `orders`
- `menuItems`
- `vendorApplications`
- `riderApplications`
- `adminSettings`

## Planned Storage Paths

- `users/{userId}/profile/*`
- `vendors/{vendorId}/images/*`
- `menu-items/{vendorId}/*`
- `riders/{riderId}/documents/*`
- `applications/{applicationId}/*`

## Integration Notes

Do not put real API keys or service account credentials in this repo until deployment strategy is confirmed. Firebase web config keys are public identifiers, but environment-specific config should still be managed carefully.
