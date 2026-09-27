# Mama Meals

Mama Meals is a mobile-first Kenyan food delivery web app. The existing interface is backed by Firebase Authentication, Firestore, Cloud Functions, and Cloud Storage, with Netlify serving the production `dist/` build.

## Architecture

```text
mama-meals/
  *.html                         Customer, partner, admin, and authentication screens
  assets/css/style.css           Shared responsive design and brand styles
  assets/js/app.js               UI, anonymous cart/location preferences, and page flows
  assets/js/firebase-client.js   Firebase Auth, Firestore, callable function, and Storage client
  functions/index.js             Trusted order, application, role, menu, and rider operations
  firebase/firestore.rules       Deny-by-default Firestore authorization
  firebase/storage.rules         Private application files and controlled image uploads
  scripts/build-production.js    Netlify production bundle and runtime config generation
  scripts/check-links.js         Local link and asset validation
  netlify.toml                   Netlify build and publish configuration
  firebase.json                  Functions, rules, and Firebase Hosting configuration
  config.json                    Public brand, pricing, contact, and architecture metadata
  images/                        Existing images, preserved with their original names
```

## Security Model

- Firebase Authentication is the only account source. Email/password sessions use Firebase browser persistence and email verification.
- Passwords, account records, applications, orders, partner profiles, menus, and roles are never stored in browser `localStorage`.
- `localStorage` is used only for the anonymous cart and selected delivery area.
- On startup, obsolete prototype account, password, application, order, and partner records are removed from browser storage. They are not migrated into Firebase; customers must create or sign in to a Firebase account.
- Admin, vendor, and rider access is enforced with Firebase Auth custom claims set by trusted callable functions.
- Partner application images pass through a verified, owner-bound callable upload. Browser Storage access to `applications/` is denied; the server writes without Firebase download tokens. Public menu uploads remain separate.
- Application and menu uploads are checked server-side for MIME type, 2MB maximum size, minimum 800x600 resolution, and 1:1 or 4:3 aspect ratio. Visual declarations such as no watermark or blur still require admin review.
- Order prices, totals, role transitions, status changes, and reference numbers are controlled by Cloud Functions rather than browser values.
- Firestore and Storage rules deny unrecognized paths and all direct protected writes.
- The initial admin bootstrap callable accepts only the server-side allowlisted Firebase UID. No admin token, password, service account, or private API secret is shipped to the browser.

Firebase Web App configuration values are public identifiers by design. Private credentials must be stored in Google Secret Manager or the Cloud Functions environment and must never be added to Netlify client variables, `config.json`, or frontend JavaScript.

## Firebase Data

The production foundation uses these collections:

- `users/{uid}`: customer profile and server-maintained role labels
- `applications/{applicationId}`: cook/rider applications and protected document metadata
- `vendors/{uid}` and `riders/{uid}`: approved partner profiles
- `menuItems/{itemId}`: vendor-owned menu items
- `orders/{orderId}`: server-priced customer orders and delivery state
- `systemCounters/{date}`: private server-only order numbering

Application images are stored below `applications/{uid}/{applicationId}/`. Vendor menu images are stored below `vendors/{uid}/menu/{itemId}/`. Plate-bearing rider vehicle photos remain private application images, not public menu media.

## Local Setup

Install frontend and function dependencies:

```powershell
npm install
cd functions
npm install
cd ..
```

Cloud Functions target Node.js 22. The Netlify frontend build uses Node.js 20.

Create a Firebase Web App in the existing Firebase project, enable Email/Password Authentication, and set the public Web App values in the shell or a local untracked `.env` workflow using the names in `.env.example`:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_MEASUREMENT_ID` (optional Analytics identifier)
- `FIREBASE_FUNCTIONS_REGION` (defaults to `europe-west1`)

For local builds, place the public Web App values in the git-ignored `.env.local` file. The build loads this file when present; environment variables supplied by Netlify take precedence. Do not put private credentials in this file.

No active Firebase CLI target is committed. The read-only release preflight expects the existing `mamameal-8946b` project; select and verify the intended project before any approved manual deployment:

```powershell
firebase login
firebase use --add
```

## Checks And Build

```powershell
npm run check
npm run test:firebase-security
npm run build:isolated-check
npm --prefix functions run check
```

`npm run build` replaces `dist/`, bundles the modular Firebase client, minifies the existing CSS and app JavaScript, injects only public Firebase Web App configuration, copies the existing images unchanged, and adds the Netlify redirects and security headers. Do not run it in a worktree with modified `dist/` unless those changes may be replaced. `npm run build:isolated-check` validates the production branch with synthetic public config without changing the working `dist/`.

The full production gate order, safe smoke test, and rollback procedure are in [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md). `npm run preflight:production` validates supplied public environment variables and local configuration without contacting the live project.

When Netlify sets `CONTEXT=production`, the build fails if required Firebase Web App variables are missing. Local builds remain available with a fail-closed empty config for code and layout checks.

## Netlify Production Setup

Netlify reads `netlify.toml`, runs `npm run build`, and publishes `dist/`. Add the public Firebase Web App variables above in **Site configuration > Environment variables**. Do not add Admin SDK keys, service-account JSON, M-Pesa secrets, email provider secrets, or Storage credentials.

Netlify deploys the frontend only. Deploy the trusted backend separately from an authorized workstation after reviewing the selected Firebase project:

```powershell
firebase deploy --only functions,firestore:rules,storage
```

After the backend is deployed, sign in with the allowlisted initial admin Firebase account, open `admin-dashboard.html`, and choose **Verify Admin Access** once. The callable function verifies the UID server-side, creates the admin custom claim, and refreshes the session.

## Current Integration Boundaries

- M-Pesa, Google Pay, Apple Pay, and card payment processing remain UI placeholders. Payment secrets and callbacks need a server-side payment integration.
- Application confirmation email is not sent until a transactional email provider is configured in Cloud Functions.
- Firebase App Check is not enabled yet; enable it after registering the final production domains and test it before enforcement.
- Static catalogue dishes remain supported by a server-owned price list. Publishing approved vendor menu items into customer search is a separate catalogue integration step.
- Visual quality rules such as no watermark, logo, text, clutter, or blur cannot be proven reliably by MIME and dimension checks; admin approval remains required.
- New cook/rider intake and review fail closed until complete retention periods are configured in the Functions environment. Eight owner-approved operational values are configured locally only in ignored `functions/.env.local`; they are not deployed. Confirmed applicant notice, the declined appeal window, open appeals/disputes, and reviewed legal holds gate private-file deletion. The proposed hourly worker also flags old pending applications without deleting them. Long-term application-record and access/security-log retention remain unresolved. See [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) and `firebase/STORAGE_PROPOSAL.md`.

## Brand And Assets

The existing colors, responsive layouts, and image files remain the design source of truth. Production builds copy all files in `images/` without renaming or visual modification.
