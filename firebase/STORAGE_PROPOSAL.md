# Private partner uploads: local integration, not deployed

The local combined rules in `storage.rules` now contain the tested private
application path and retain separate vendor menu/profile image paths.
`storage.application.proposed.rules` remains an isolated reference; do not
deploy it alone because it denies all non-application images. The emulator
config tests the combined file. Production Storage rules remain unchanged.

## Application lifecycle

1. A verified user calls `startPartnerApplication`. The server validates form
   fields, generates the application ID, writes `applications/{applicationId}`
   with its own `userId`, `type`, `status: draft`, and a 24-hour expiry, and
   reserves `applicationSlots/{sha256(uid:type)}` in a transaction.
2. The browser calls `uploadApplicationDocument` with one JPG, PNG, or WebP
   image at a time (maximum 2 MB). The server validates Auth, draft ownership,
   slot, image bytes and dimensions, then performs a generation-guarded write
   without a download token. Clients have no direct Storage read or write
   permission under `applications/`. The paths are:

   ```text
   applications/{uid}/{applicationId}/cook/identityDocument
   applications/{uid}/{applicationId}/cook/foodSafetyDocument
   applications/{uid}/{applicationId}/cook/foodPhoto
   applications/{uid}/{applicationId}/rider/identityPhoto
   applications/{uid}/{applicationId}/rider/vehiclePhoto
   ```

3. `submitPartnerApplication` derives required paths from the server draft,
   verifies object metadata, bytes, image format and dimensions, then moves
   the draft and slot to `pending` in a transaction. The client cannot assign
   owner, role, status, type, or document paths. A repeated submit returns the
   original reference; a pending/approved application cannot be replaced.
   A declined application can retry with a new draft.
4. Upload failure invokes `cancelPartnerApplication`, which closes the draft
   before privileged file deletion. A successful submission with a lost client
   response is reported as pending rather than deleted. Replaced, cancelled,
   or expired drafts retain `cleanupPending: true` for an hourly privileged
   sweep. Cleanup is attempted immediately and repeated after a one-hour grace
   period to catch uploads that were already in flight when the draft closed.
   Due-time queries and retry backoff prevent newer drafts or malformed expired
   drafts from starving overdue work. Private file listing is capped to the
   expected fields plus one and refuses unexpected paths. The scheduled
   `cleanupAbandonedApplications` function is local code only.

## Document review

No client (including admins) may get/list private application Storage objects.
The admin UI calls `getApplicationDocument(applicationId, field)`. The server
requires a verified admin custom claim, checks the submitted application and
exact recorded object generation, logs access to the server-only
`applicationDocumentAccess` collection, and returns bytes in the authenticated
callable response. It never returns a download token or signed URL. Only the
existing admin claim is recognized; a separate reviewer role is not assumed.

Review decisions first commit a resumable `reviewing` record, then the final
Firestore decision and approved profile, then the Auth custom claim. A pending
reconciliation flag remains until all stages finish. Same-decision retries and
the proposed hourly worker can resume a crash; conflicting decisions fail.

Submitted-file retention is disabled until all approved and declined document
classes have owner-approved periods in Functions. The status-wide
`APPLICATION_APPROVED_RETENTION_DAYS` and
`APPLICATION_DECLINED_RETENTION_DAYS` keys remain fallbacks; independent
`IDENTITY`, `FOOD_SAFETY`, `VEHICLE` and `FOOD_PHOTO` overrides are available
for each decision. No periods are set. New intake and review fail closed when
the policy is incomplete. The hourly worker still cleans drafts and already-
due documents if configuration later becomes invalid. Once due, it validates
the entire manifest, deletes only due exact generations, removes their
metadata and schedules the next document; retries are idempotent. Public
vendor menu images are separate and untouched. Appeal, application-record and
access-log retention still require policy and implementation decisions.

## Local validation and production gates

Run `npm run check` and `npm run test:firebase-security` with Node 22+ and
Java 21+. On this host, Java is under Android Studio `jbr`; the Firebase
emulator cache is on D:. Tests use only a `demo-` emulator project.

Before any production rollout, review the trusted admin UID and access policy,
decide document retention periods, approve the Cloud Scheduler job and cost,
verify that the Storage Rules service agent can read the default Firestore
database for the separate menu-image rule, and test real Auth, IAM, private
previews, retention, and menu images in a controlled environment. Deploy the
coordinated backend and rules only with explicit approval. No Uniform
Bucket-Level Access, IAM, billing, live rules, data, or deployment changed here.
