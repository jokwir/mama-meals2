# Mama Meals production activation runbook

**Status: PUBLIC LAUNCH BLOCKED.** The backend is partly deployed, but this
checklist is not authorization for further production changes. Project ID:
`mamameal-8946b` (project number `484996350624`).
Keep the working `dist/` untouched; source files are authoritative. Require an
explicit owner go/no-go at every cloud-changing step. Never use real identity
documents for smoke tests.

## Verified production checkpoint (2026-09-27)

This is a historical checkpoint. The Scheduler update below supersedes its
statements about the job and maintenance endpoint.

- Six reviewed Firestore composite indexes are enabled. Firestore and Storage
  rules match the locally emulator-tested source. The Storage service agent has
  the Firestore Rules service-agent role; bucket Public Access Prevention is
  enforced and Uniform Bucket-Level Access remains disabled.
- The server-owned `adminSecurity/global` gate exists with `enabled:true`,
  `bootstrapEnabled:true` and no blocked UIDs. It does not itself grant a role.
- All 21 callable Functions remain active in `africa-south1` on Node.js 22.
  The private `cleanupAbandonedApplications` HTTP endpoint is also active there
  (22 Functions total), with one instance, one concurrent request and a
  120-second timeout. An empty anonymous POST returned HTTP 403 at the platform
  boundary. Earlier anonymous calls to `bootstrapAdmin` and
  `startPartnerApplication` returned `UNAUTHENTICATED`.
- The Firebase CLI enabled the Cloud Scheduler API during the first callable
  deployment, but no job was created. Cloud Scheduler does not support
  `africa-south1`. The keyless service account
  `mamameals-scheduler-invoker@mamameal-8946b.iam.gserviceaccount.com` is
  enabled. The Cloud Run permissions panel for `cleanupabandonedapplications`
  in `africa-south1` shows it as the sole `Cloud Run Invoker` principal on that
  function. No project-wide role was assigned in the service-account wizard;
  the separate project IAM page did not load, so verify project-wide grants
  again before creating the job. An anonymous POST still returned HTTP 403
  after the grant. A separately reviewed OIDC Scheduler job in a supported
  region is still required before activating application retention or public
  intake. See the
  [supported Scheduler locations](https://cloud.google.com/scheduler/docs/locations).
- The `africa-south1/gcf-artifacts` repository has a seven-day cleanup policy
  for old Function container images. This is separate from applicant-document
  retention.
- The bootstrap Auth UID exists, but its email is unverified and it has no
  admin claim. The owner must complete real email verification before invoking
  bootstrap. Do not mark it verified through an Admin API shortcut.
- No Netlify release, production test application, sensitive upload, real ID
  document, or Scheduler job was created at this checkpoint. The working
  `dist/` remains untouched.

## Scheduler checkpoint (2026-09-28)

- `mamameals-hourly-application-maintenance` is enabled in `europe-west1` at
  `0 * * * *` UTC, with zero retry attempts. It sends an empty authenticated
  POST to the private Johannesburg `cleanupAbandonedApplications` Function.
- The Function's sole `Cloud Run Invoker` member is the dedicated Scheduler
  service account. Its deploy environment must include
  `APPLICATION_MAINTENANCE_INVOKER_EMAIL` for that exact account; deploying
  with `invoker: private` removes the service-scoped grant.
- A forced execution succeeded (HTTP 204) after the empty parsed request-body
  compatibility fix. Keep checking subsequent hourly executions and maintenance
  failure markers before opening public application intake. No Netlify release
  or real applicant documents were involved in this verification.

Ruleset IDs recorded at this checkpoint (reverify live releases before any
rollback; restoring deny-all rules would intentionally stop application access):

| Resource | Prior deny-all ruleset | Current reviewed ruleset |
| --- | --- | --- |
| Firestore | `projects/mamameal-8946b/rulesets/227e0ffa-93bd-4da1-984f-0bac85f9e5b8` | `projects/mamameal-8946b/rulesets/9faf8e9a-672a-4b18-8f6a-fabb1f1d0716` |
| Storage | `projects/mamameal-8946b/rulesets/b17fa356-d7e4-406a-b023-22367f762f18` | `projects/mamameal-8946b/rulesets/c678996a-6eb7-4961-8183-93581147fe39` |

## Locally approved operational retention

These are Mama Meals operational choices, **not statutory Kenyan retention
periods**. They are in ignored local and project-scoped Functions environment
files and on the deployed callables. No scheduled maintenance worker is active,
so production deletion is not yet running. A legal/privacy review and explicit
worker activation are still required before public applicant intake.

| Private application document | Approved | Declined |
| --- | ---: | ---: |
| Identity document/photo | 7 days | 30 days |
| Cook food-safety document | 30 days | 30 days |
| Rider vehicle/plate image | 7 days | 30 days |
| Private application food photo | 7 days | 30 days |

The baseline clock starts at the server-recorded decision. For declined
applications, deletion cannot happen before the 14-day appeal-request window
measured from **confirmed** applicant notice. Until notice is confirmed, all
private application documents are held. An open appeal, active dispute or
active legal hold pauses deletion. Closing protection uses the later of the
original deadline, the appeal-window end and the close/release time; it does
not restart the retention period. The seven-day internal appeal response
target is an operational target, not an automatic closure. A declined appeal
can be upheld/withdrawn by an authorised admin. Approval reversal uses a
recorded recommendation and confirmation by distinct verified admins; the
server reconciles claim/profile state after an interrupted transition. The
original decline and reversal remain separate immutable application events.
An open appeal blocks another draft of the same role, but not the other role.

Decision notice is designated for the applicant's verified account email.
The app does **not** currently send mail or establish delivery confirmation.
An admin click cannot start the appeal clock: the server requires a matching
server-owned receipt for the current decision revision with a send-attempt
timestamp, later provider-confirmed timestamp and verified-email channel.
No production receipt writer exists yet, so notice stays unconfirmed and
relevant document deletion stays blocked until a trustworthy integration is
separately reviewed. Decision, send attempt and confirmed delivery must be
separate facts; never manufacture a receipt from an admin action.
The authenticated account currently shows the decision but not the appeal
state/window; its declined-card reapply link does not account for an open
same-role appeal. That applicant-facing flow needs a separate reviewed UI
change before public appeal intake.
An active legal hold has a coded reason, all-private-document scope, start,
responsible admin and a required review date within 90 days. Overdue holds
receive at most three seven-day review reminders, then require manual
intervention; they never auto-release. Before production intake, establish an
operational owner and alert route for pending notice, pending review, overdue
appeals and holds. The server does not send email alerts yet.

Incomplete drafts still expire after 24 hours with the existing one-hour
in-flight cleanup grace. Submitted pending applications are **not** draft
cleanup targets. After seven days pending, a bounded worker flags them for
human review without deleting any submitted file. Older pending records need
a reviewed backfill for this alert field.

When the last private document is deleted, the worker immediately strips raw
form fields, upload-attempt data and document manifests while retaining the
account link, reference, applied role, decision/coded reason, verification
outcome, relevant timestamps, reviewer, appeal/hold history and per-class
deletion timestamps. Ordinary public vendor menu images are separate and are
not affected. A cleaned cancelled/expired draft record is due for deletion
after 30 days. A minimal declined record is due 180 days after the later of
the confirmed-notice appeal window and final appeal/dispute closure. Active
appeals, disputes and legal holds pause record deletion. Approved records
remain while the partnership is active; the 180-day clock after offboarding
requires a trusted completed-offboarding marker and claim-revocation time.
No production offboarding action is exposed yet, so approved-record deletion
remains inactive. The bounded record worker atomically removes the record,
its application events, matching claim-audit events and notice receipt.
Private-document access events are deleted no earlier than 180 days after
both case closure and last access. Admin bootstrap/revocation audit events
are due 180 days after a completed revocation. Application decision/appeal
events and partner-claim events expire with the minimal application record.
Security suspensions are not assumed to end a partnership. Routine Cloud
Logging configuration, including platform-controlled `_Required` retention,
is unchanged; any 30-day redacted operational-log target needs a separate
logging review. Resolved maintenance failures keep only a redacted category,
attempt count, code and timestamps for 90 days in a server-owned collection.
Legacy
already-purged records need a reviewed backfill; no Firestore TTL is enabled.

### Document configuration map (local only)

For **both** `APPROVED` and `DECLINED`, choose days for all four classes:

```text
APPLICATION_<DECISION>_IDENTITY_RETENTION_DAYS
APPLICATION_<DECISION>_FOOD_SAFETY_RETENTION_DAYS
APPLICATION_<DECISION>_VEHICLE_RETENTION_DAYS
APPLICATION_<DECISION>_FOOD_PHOTO_RETENTION_DAYS
```

The existing `APPLICATION_APPROVED_RETENTION_DAYS` and
`APPLICATION_DECLINED_RETENTION_DAYS` remain compatible as a status-wide
fallback. A class-specific value overrides the fallback. Prefer explicit
class values; no partial configuration without a fallback is accepted. The
production preflight checks complete coverage. Locally it loads the ignored
`functions/.env.local` and checks the ignored project-scoped
`functions/.env.mamameal-8946b` used for callable deployment. The backend uses
`APPLICATION_FUNCTIONS_REGION` because Firebase reserves the `FIREBASE_`
prefix in Functions environment files; the web build uses
`FIREBASE_FUNCTIONS_REGION`. Both must select `africa-south1` for this release.
These variables are **Functions server environment**, never web or Netlify
public variables. Every accepted value is an integer from 1 to 3650 days.
`APPLICATION_RECORD_MINIMIZE_DAYS_AFTER_PURGE` remains unset for legacy
already-purged records; newly purged records are minimised immediately in the
same transaction. Legacy records require a reviewed, bounded backfill.
Cloud Logging retention and an operational offboarding process remain
separate production decisions.

## Region and endpoint plan (no migration authorized)

The source fallback remains `europe-west1` (Belgium), but the project-scoped
Functions environment and the repository's `netlify.toml` production context
target `africa-south1` (Johannesburg), matching Firestore and Storage. The
current Netlify Drop site does not build from that file. No Functions
were deployed before this initial-region choice, so this is not a migration.
Keep both deployed runtimes and the web build on the same reviewed region.
Firebase supports second-generation Functions in `africa-south1`.

A future region change requires a separate approved migration window. The
current single `setGlobalOptions` region controls callables **and** the
scheduled worker, so changing the one environment variable is **not** a safe
staged migration. Before approval, prepare a reviewed release that can deploy
new-region callables while pinning exactly one worker to the old region, and
verify the Firebase CLI deploy plan will not delete old callable endpoints.

Future staged sequence for any later region change, not to run now:

1. Inventory actual deployed callable names/regions, Scheduler job, client
   build configuration, last known-good revisions and traffic baseline.
2. Prepare and emulator-test dual-endpoint compatibility plus an independently
   pinned single Scheduler region. Keep the old callable endpoints available.
3. Deploy new-region callables only, with no second active Scheduler job;
   smoke-test generated data against the new endpoints.
4. Change the Netlify build's `FIREBASE_FUNCTIONS_REGION` to the new region,
   release it, and verify both new and still-open old clients. Roll back the
   web build to the old region immediately if callable routing fails.
5. After old-client traffic drains, move the one scheduled worker in a
   separately reviewed step. Verify no overlapping old/new jobs, then retire
   old callables. Keep a rollback window and known-good old-region code.

Do not run old and new scheduled maintenance functions at once: dual jobs can
duplicate invocations, contend on records, and increase cost. Keep only one
region's Scheduler job active throughout the handover.
Changing a region can create new endpoints and schedules rather than moving a
function in place. A premature old-region deletion can interrupt clients;
rollback requires switching the web client back while the old callable is
still available, or redeploying the known-good old-region code. Firestore and
Storage stay put; their contents are not migrated by this setting. Reconfirm
pricing, service availability, exact bucket location and IAM before any move.
See [Firebase Functions locations](https://firebase.google.com/docs/functions/locations).

## Local operational limits (no production setting changed)

Verified accounts are limited server-side to 8 new application drafts and 24
private-upload attempts per UTC day, with at most 9 upload attempts per draft.
These values are defaults, not retention policy. They can be tuned only in the
Functions server environment via `APPLICATION_DRAFTS_PER_DAY`,
`APPLICATION_UPLOADS_PER_DAY`, and `APPLICATION_UPLOADS_PER_DRAFT`. The server
also caps private-image resolution at 40 million pixels via
`APPLICATION_IMAGE_MAX_PIXELS`; accepted files remain limited to 2 MB. The
rate ledger is server-owned Firestore data and rolls over by UTC day; it has
no automatic deletion yet, so plan a bounded ledger TTL/cleanup before large
scale. A user may maintain at most one active draft per role; a new draft of
the same role cancels the previous one, and the account has a 100-application
lifetime cap. These controls do not stop scripted account creation, request
bandwidth before a callable starts, or traffic from many verified identities.
Consider App Check and account-abuse monitoring later, with owner approval.

Maintenance failures use exponential backoff and stop automatic retries after
8 attempts by removing the due field and setting
`jobFailures.<expiry|cleanup|review|retention|minimization|record-purge|audit-access|audit-claim|audit-failure>.blocked=true` on
the application. The count, sanitized error code and last-at timestamp are
stored; logs include a structured first-failure and blocked event, not raw
form data. `APPLICATION_JOB_MAX_ATTEMPTS`,
`APPLICATION_JOB_RETRY_BASE_MINUTES`, and
`APPLICATION_JOB_RETRY_MAX_HOURS`, and `APPLICATION_JOB_PAGES_PER_RUN` are
server-only bounded tuning knobs. Each job processes at most two 100-record
pages per hourly run by default, so a full first page of failures does not
starve the next page. An
operator must inspect a blocked record and affected private object generations
through trusted Admin SDK access, fix the cause, then transactionally clear
the specific job failure and restore its due field. Never reset ownership,
status or document-generation guards to make a job pass. For blocked review,
reconcile Auth claims and profile state before retrying. Alert on blocked
records and Scheduler failures; no production alert is configured yet.

## One-step-at-a-time activation (future, with approval)

Local read-only inspection, bounded dry-run backfill and legacy inventory are
documented in [MAINTENANCE_TOOLING.md](MAINTENANCE_TOOLING.md). No production
diagnostic or backfill has been run. Review its checkpoint and stale-record
rules before any approved migration.

1. **Authenticate Firebase CLI interactively.** When the owner is back at the
   computer, sign in using the intended owner account and verify both project
   ID `mamameal-8946b` and project number `484996350624`. Stop if ambiguous.
   Authentication alone authorises no deployment.
2. **Approve launch policy and operators.** Reconfirm the local operational
   periods, legal/privacy review, verified-email receipt mechanism, hold and
   dispute owner, alert route, two distinct reviewers and a backup-admin UID.
   Define the trusted offboarding authority and active-order treatment before
   activating approved-record deletion. Do not invent any of these.
3. **Freeze a known-good baseline.** Record current Git revision, current
   Firebase rule releases, Functions revisions, Firestore indexes, active
   Scheduler jobs, Netlify deploy ID and relevant environment variable names.
   Use a separate known-good checkout for rollback; never reset this worktree.
4. **Verify local candidate.** Review all diffs and run `npm run check`,
   `npm run test:firebase-security`, and `npm run build:isolated-check`. The
   emulator must use `demo-mama-meals-storage-rules`. The isolated build uses
   synthetic public config and verifies `dist/` hashes; do not run the
   destructive `npm run build` in this working tree.
5. **Verify project and services.** Confirm the owner account selected
   `mamameal-8946b`, the exact default bucket name and region, Firestore's
   `africa-south1` location, Auth email/password and verification, and current
   Public Access Prevention. Do not change billing or Uniform Bucket-Level
   Access. Confirm no live ID documents exist before migration assumptions.
6. **Verify the initial admin UID.** Match the server-only bootstrap UID in
   `functions/index.js` to the intended verified Firebase Auth owner. Agree on
   claim revocation, lost-account recovery and two-person review policy. A
   browser account cannot self-assign admin/vendor/rider claims.
7. **Review cost safeguards.** Set owner-approved billing alerts and monitor
   Firestore reads/writes, Storage operations/bytes, Functions invocations and
   Cloud Logging. Alerts are not a hard spend cap. Approve the hourly job and
   expected cost before it is created. No budget/billing setting is changed by
   this runbook.
8. **Verify IAM and bucket prerequisites.** For the separate vendor menu-image Storage
   rule's `firestore.get()`, confirm the Firebase Storage service account has
   the **Firebase Rules Firestore Service Agent** role. Use the Firebase
   console/CLI prompt and IAM view; do not grant browser users bucket access.
   Reverify Public Access Prevention and Uniform Bucket-Level Access states.
   Private application Storage paths must still deny direct client access.
9. **Configure environment privately.** Set the public Firebase Web App values
   for the Netlify build and the approved document periods in the Functions
   server environment. Keep service-account keys, payment secrets and real
   documents out of the repo and web bundle. Run `npm run preflight:production`
   with the intended public values in the local release environment. It checks
   project/bucket/region and complete retention coverage without cloud calls.
   Confirm the Functions runtime will receive the same approved periods.
   If a region migration is separately approved, follow the region plan above;
   changing this variable in only one environment breaks callable routing.
10. **Deploy indexes only.** From the reviewed checkout, run the approved
   Firebase CLI index deploy for this exact project. Wait until every index is
   **Ready**. The candidate has six reviewed composite indexes; record and
   audit due-time fields use single-field indexes. **Rollback point:** stop
   here if an index fails;
   do not enable worker traffic or remove older indexes.
11. **Provision the server-owned admin emergency gate.** After a separate
   approved Admin SDK write, verify `adminSecurity/global` has `enabled:true`,
   `bootstrapEnabled:true` and an empty `blockedUids` list. Browser writes
   must remain denied. Missing or malformed gate intentionally denies admin
   actions. Record the trusted operator and rollback; never put a backup UID
   or service-account key into the web bundle.
12. **Deploy rules only.** Deploy the reviewed Firestore and Storage rules.
   Verify application direct read/write/list remains denied, owner-only
    application Firestore reads, gated admin access and approved vendor
    menu-image access. Stop
   if a rule is unexpectedly permissive. **Rollback point:** redeploy the
   recorded known-good rules from the separate checkout.
13. **Deploy Functions callables only.** Explicitly scope the Firebase CLI
    command to reviewed callable names; exclude the scheduled worker. Check
    each endpoint and its region. Do not route web traffic yet. **Rollback
    point:** restore known-good callables while preserving application data.
14. **Bootstrap admin once.** Sign in as the verified, UID-matched owner and
    call the server bootstrap action. The new account-page verification button
    is not yet on the live Netlify site; use a reviewed localhost build (the
    Firebase Auth authorized domains include `localhost`) or an access-limited
    staging preview built from current source to send and complete the real
    verification email before bootstrap. Do not use the stale working `dist/`
    or set `emailVerified` through an Admin SDK shortcut. Confirm the claim is
    server-issued and refreshed, then test an unclaimed reviewer is denied.
    Provision and verify
    the separately selected backup reviewer through a trusted server/IAM
    procedure, not a browser control. Record who approved each action. Auth
    claim changes do not roll back with code deployment.
15. **Run a non-sensitive backend smoke test.** With separately approved test
    accounts and generated 800x600 JPG/PNG/WebP images only, submit a cook and
    rider draft, verify private object metadata has no download token, test
    cross-user and anonymous denial, admin preview audit, approve/decline,
    two-person reversal, emergency denial, claim reconciliation, and vendor
    menu-image isolation. Verify notice remains unconfirmed without real
    delivery evidence. Record test IDs and clean them only through reviewed
    server/admin procedures. No real ID scans.
16. **Monitor activated maintenance.** The hourly OIDC Scheduler job in
    `europe-west1` now invokes the private Johannesburg Function successfully.
    Its first automatic run at 2026-09-28 17:00 UTC finished with HTTP 204;
    the earlier force-run also succeeded. Continue monitoring subsequent runs.
    Its source definition names the dedicated invoker service account through
    `APPLICATION_MAINTENANCE_INVOKER_EMAIL`, checked by production preflight.
    A future Function deployment must preserve that variable and verify the
    sole `Cloud Run Invoker` binding afterwards. Confirm subsequent scheduled
    runs, bounded cost and failure logging before opening intake. Never grant
    `allUsers` or `allAuthenticatedUsers` invocation. **Rollback point:** pause
    the job; never loosen private rules to make it run.
17. **Configure and release Netlify.** The intended test site is
    `mamamealstest2.netlify.app`. As checked on 2026-09-28, it was last
    published through Netlify Drop on June 9, is not connected to this GitHub
    repository, and has no project environment variables. Pushing `main` will
    not publish to this site. Confirm the domain, authorized Auth domains and
    all six public Firebase Web App build values. Review the dirty worktree
    before committing. Choose and separately review either connecting this
    site to `jokwir/mama-meals2` `main` with a clean Netlify build, or manually
    uploading an isolated production build made from the reviewed source and
    verified configuration. Never upload the stale working `dist/`. Record the
    previous deploy ID before release. A successful build is not proof that
    email, payments or real fulfillment are live.
    **Rollback point:** republish the recorded prior Netlify deploy if the
    frontend fails, then assess backend compatibility before rolling it back.
18. **Post-launch monitoring.** On desktop and small mobile screens, test login,
    customer browse/cart/order, cook/rider applications and confirmations,
    admin authorization, approved partner access, search, images and brand
    colours. Monitor failed reviews, notices, holds, audit deletion, scheduled
    cleanup, index status and billing metrics. Confirm email/payment
    placeholders are described honestly.
    Record a final go/no-go; only then open normal applicant intake.

Before enabling legacy accounts or catalogues, run a separately approved,
read-only inventory of old `vendorApplications`, `riderApplications`, users,
vendors and menu items. The old `isAvailable` field is not trusted as the new
`available` flag; unavailable or unreviewed legacy dishes are deliberately
not orderable. Any role or identity-document migration needs its own reviewed
plan and cannot be inferred from legacy profile text alone.

Future Firebase CLI commands, **not to run now**, from the approved checkout:

```powershell
firebase deploy --project mamameal-8946b --only firestore:indexes
# Pause until every required index is Ready.
firebase deploy --project mamameal-8946b --only firestore:rules
# After a separate Storage-rules gate and bucket/IAM verification:
firebase deploy --project mamameal-8946b --only storage
# Build an individually reviewed --only functions:<callable> list; exclude
# cleanupAbandonedApplications until the separately approved Scheduler gate.
```

## Admin recovery and emergency suspension

The real backup-admin UID is **not selected or configured**. No browser path
can grant an admin claim or write `adminSecurity/global`. The initial bootstrap
callable remains restricted to the existing allowlisted UID and a server-owned
`bootstrapEnabled` flag; retiring that flag prevents future bootstrap grants.
Two distinct verified admins are required for an appeal reversal. Launch with
only one admin means reversals cannot be completed.

For a compromised admin, the trusted cloud operator first disables the global
gate or adds the affected UID to `blockedUids` through Admin SDK/IAM. That
immediately denies new admin Functions and Firestore requests even if an old
ID token still carries `admin:true`. Then use a separately reviewed trusted
recovery action to remove the Auth custom claim and revoke refresh tokens;
the server-only `claim-recovery.js` helper records intent/applied audit events
and retires bootstrap. Do not expose that helper as a public callable. A
refresh-token revocation does not instantly invalidate already-issued ID
tokens; in-flight operations also require incident review. Keep the gate in
place until token expiry and verification of all pending claim reconciliations.

For a lost account, suspend sensitive admin/review operations, verify identity
out of band, select the replacement UID with the owner, then grant authority
only through a trusted server/IAM procedure with structured audit. Do not
unblock the lost UID merely to make bootstrap work. For stale partner claims,
trusted revocation first suspends the partner profile, then clears the custom
claim and revokes refresh tokens; approved-profile checks deny order actions
while old tokens expire. Security suspension is not offboarding and does not
start the approved-record 180-day clock. Reconcile any incomplete grant or
revocation before reopening operations. The exact backup identity, IAM
operator and incident communications require owner approval at the computer.

## Incident and rollback notes

Abort on public private-file access, wrong project/bucket, unsafe download
token, retention configuration gap, incorrect admin UID, failed index,
claim/profile inconsistency, runaway cleanup, unexpected cost, or broken
menu-image access. From the recorded **known-good checkout** only, and with
incident approval, the same scoped rules/Functions deploy commands above can
restore prior code and rules. Do not use `git reset` in the user's worktree.
Netlify can republish its recorded prior deploy. Indexes are forward-only
until no deployed version needs them. Rollback does not undo Firestore writes,
Storage deletions, Auth claims or audit entries; reconcile those separately
with a trusted procedure and preserve evidence. Do not loosen private rules
to recover a broken application.

## Cost and operational review

- The hourly worker uses due-time queries capped at two pages of 100 documents
  per stage, one instance and one concurrent request. It does not scan every application.
  A backlog drains over later runs. Per-draft Storage listing is capped at the
  expected document count plus one and refuses unexpected paths.
- Malformed due records now back off and become blocked after a bounded number
  of failures; blocked records do not monopolise the first 100 due entries.
  Operational alerting and a trusted manual-repair procedure are still needed.
- New applications require verified Auth plus server-owned per-account quotas.
  A malicious user can still create many verified accounts or send costly
  requests up to each quota. Assess App Check, monitoring and budgets before
  public launch; none are activated locally.
- The source fallback is `europe-west1`, while the project-scoped Functions
  environment and Netlify production context select `africa-south1`. Verify
  the deployed endpoints and web configuration agree before public launch.
  Any later region change needs a staged, approved rollout.
- Scheduler job pricing is separate from Functions, Firestore, Storage and
  Logging usage. Menu-image rules call Firestore and can incur reads. Use
  current official pricing and project metrics, not a fixed estimate.
- The UI cannot reliably detect blur, watermarks, authenticity or food safety;
  trained human review remains necessary. Transactional email, payments and
  live rider location remain placeholders, not live services.

Primary references: [Kenya Data Protection Act section 39](https://www.odpc.go.ke/wp-content/uploads/2024/02/TheDataProtectionAct__No24of2019.pdf),
[Data Protection General Regulations regulation 19](https://www.odpc.go.ke/wp-content/uploads/2024/03/THE-DATA-PROTECTION-GENERAL-REGULATIONS-2021-1.pdf),
[Firebase scheduled functions](https://firebase.google.com/docs/functions/schedule-functions),
[Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing),
[Firestore pricing](https://cloud.google.com/firestore/pricing),
[Firebase Storage pricing](https://firebase.google.com/pricing), and
[cross-service Storage Rules permissions](https://firebase.google.com/docs/rules/manage-deploy).
