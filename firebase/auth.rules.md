# Firebase Authentication And Roles

Firebase Authentication email/password is the only account provider used by the current web app. Enable it in the Firebase Console and configure the authorized Netlify production domain.

## Session Rules

- Firebase browser persistence keeps the signed-in session across reloads.
- New accounts receive a Firebase verification email.
- Email verification is required before partner applications and order creation.
- Password reset email is sent by Firebase Authentication.
- No password or account session is stored in application `localStorage`.

## Role Claims

Protected roles are Firebase Auth custom claims:

- `admin`: access to admin reads and the application approval callable
- `vendor`: access to the vendor dashboard, vendor-owned menu/profile data, and vendor order actions
- `rider`: access to the rider dashboard, approved rider profile, available deliveries, and assigned delivery actions

Every signed-in account is treated as a customer. The callable backend also keeps a display-only `roles` array in `users/{uid}`; Firestore rules and callable functions trust custom claims, not that array.

## Approval Flow

1. A verified user uploads required files to their own protected Storage path.
2. `submitPartnerApplication` validates ownership, type, size, dimensions, aspect ratio, and application fields before creating a pending Firestore record.
3. An admin custom claim is required to call `reviewPartnerApplication`.
4. Approval sets the vendor or rider custom claim through the Admin SDK and creates the corresponding approved partner document.
5. The user's client refreshes its ID token before protected dashboard access is granted.

The initial admin bootstrap callable is restricted to the server-side allowlisted Firebase UID. All other callers receive `permission-denied`.
