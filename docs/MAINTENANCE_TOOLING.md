# Local maintenance diagnostics and backfill preparation

These scripts are admin-side only. They are not bundled into the website or
exposed as Firebase callables. This document is preparation, not permission to
run against production. Never use real applicant images in emulator tests.

## Blocked-job inspection

`node scripts/maintenance-cli.js inspect --emulator --batch-size=50` requires
`FIRESTORE_EMULATOR_HOST=127.0.0.1:18080` and uses only the demo project
`demo-mama-meals-storage-rules`. It is read-only. Each invocation scans at
most 100 application records, 50 by default, ordered by document ID. The
JSON result includes `nextCursor`; pass it back as `--cursor=<id>` to continue.
An exact page may yield a cursor even when the next page is empty. Restart
from no cursor for a final sweep, since newly inserted IDs behind a saved
cursor will otherwise be missed.

Rows contain only application ID, job category, state, attempts, last failure
time and an allowlisted error code. They never include applicant fields, UID,
document names or paths, image bytes, tokens or URLs. Default output includes
`retryable`, `manual-intervention`, `unscheduled` and `inconsistent` work.
Add `--include-resolved` to see completion markers as `resolved`. A resolved
row is not proof of legal retention compliance; it only reflects job state.
The scan is bounded per invocation but a complete collection sweep still
incurs Firestore reads.

Future production inspection requires both `--production-read` and
`--project=mamameal-8946b`, a working trusted Application Default Credential,
and no emulator host. Missing or mismatched configuration stops without
falling back to another project. Do not run this while production is blocked.

## Record-minimisation backfill

`backfill-record-minimization` prepares a narrow future migration for terminal
applications whose private documents have already been purged, but whose raw
`fields` remain. It does **not** migrate legacy partner applications or
delete documents. `--days=<owner-approved-value>` is required; the tool has
no default and does not choose a policy. It skips open appeals/legal holds,
unfinished reviews, unpurged files, existing schedules and already-minimised
records. A missing purge timestamp or malformed record is skipped with a
reason, not guessed. The plan reports the exact `recordMinimizePending` and
`recordMinimizeAt` changes per application ID before any write.

The default is a **dry run**. Writes require `--apply`,
`--confirm-project=<exact-project>`, and `--confirm-schedules-deletion`;
production additionally requires `--production-read` and
`--production-write`. Each invocation is bounded to 1-100 scanned records.
Each write is a single Firestore transaction that rechecks the original
snapshot version, ownership-independent terminal state, complete document
purge, hold flags, and calculated deadline. Changed or already-scheduled
records are skipped rather than overwritten. A failed record is reported with
a sanitized code; the returned checkpoint is set before the first failure so
the next run retries it. Successful records are idempotently skipped.

Passing a cursor resumes after that document ID, not at a time-consistent
database snapshot. Before approval of an actual migration, inventory all
pages, review every proposed due date (some may already be past), and plan
an end-to-end rescan after applying. No production backfill was run here.

## Legacy inventory

`audit-legacy --emulator --collection=vendorApplications --batch-size=50`
also accepts `riderApplications`, `users`, `vendors`, `riders`, and
`menuItems`. It is read-only, paged and emits only document IDs plus issue
codes. Use `--cursor=<nextCursor>` to continue. The repository's old
`firebase/collections.schema.json` describes separate `vendorApplications`
and `riderApplications` with `rejected` status, while current Functions use
the unified `applications` collection with `declined`. Existing legacy data
must first be inventoried and its UID, application ID, documents and decision
proven; do not auto-copy it or issue claims from a browser field.

Other differences to review before any migration:

| Legacy shape | Current contract | Consequence |
| --- | --- | --- |
| `users.role` | Auth custom claims plus server-managed role/profile | Legacy role text does not grant access. Admin must verify ownership/approval before claims. |
| `vendors/{vendorId}` with `ownerId`, `businessName` | `vendors/{uid}` with `kitchenName`, approved profile and vendor claim | Old approved vendors may not enter the new dashboard until reviewed migration. |
| `menuItems.isAvailable` | `menuItems.available === true` | Missing `available` is now rejected server-side during orders; current public rules also hide it. Migrate availability only after checking intent. |
| Legacy `imageUrl` only | Verified owner-bound `imagePath` and URL | Editing may require image reupload/ownership verification; never fabricate a private or bearer URL. |
| Separate application collections and `rejected` | Unified `applications`, server-created draft, `declined` | No automatic mapping of old status or documents. |
| Earlier local-browser data | Firebase Auth/Firestore | Browser-only records do not become authenticated users or trusted applications. |

Do not loosen Security Rules to make these records visible. A migration that
could assign a role, move identity files or change an approval decision needs
separate owner authorization, evidence checks and targeted emulator tests.

## Recovery boundaries

- A timeout during private upload can be retried against the exact owner,
  draft, digest and object-generation guards; a closed draft cannot resurrect
  a purged file.
- If Storage deletion succeeds but the Firestore update fails, retry deletes
  the same recorded generation idempotently. If Firestore marks a draft closed
  and Storage deletion fails, `cleanupPending` remains for the scheduled job.
- Review claims and Firestore state are reconciled by server-owned state. A
  blocked review must be inspected before a trusted operator requeues it.
- Jobs stop automatic retries after the configured cap and retain a safe
  failure marker. A poisoned record does not permanently own the first due
  page; the worker advances through a bounded second page by default.
- The tools never repair a record by changing owner UID, status, document path
  or generation. Manual repair must be reviewed against the original evidence.
