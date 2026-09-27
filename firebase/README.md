# Firebase configuration (local candidate only)

`firebase.json` points to these Firestore rules/indexes and Storage rules.
They are local candidate files, not a statement that production has been
updated. See `STORAGE_PROPOSAL.md` for the private application lifecycle and
`../docs/PRODUCTION_RUNBOOK.md` for release gates.

The server creates `applications/{applicationId}` and
`applicationSlots/{sha256(uid:type)}`. Clients may read only their own
application records, not write statuses or document paths. Private cook/rider
files live under `applications/{uid}/{applicationId}/{type}/{field}` and are
uploaded and previewed only through trusted callables. Browser Storage rules
deny every direct read, list, write, overwrite and delete at that path.

Approved vendor menu photos have a separate public-read path under
`vendors/{uid}/menu/{itemId}/{fileName}`. The menu write rule checks an approved
vendor profile via Firestore; its Storage Rules service agent needs the
appropriate Firestore lookup permission before rollout. Rider vehicle photos
with visible plates stay with private application documents, not menu photos.

Submitted document retention is disabled until complete approved/declined
periods are provided as Functions environment values. Each status can set
independent identity, food-safety, rider vehicle and private application food
photo periods. New partner intake and review fail closed while incomplete;
draft cleanup and already-due document purges remain independent. The hourly
worker and required indexes are local proposals only. Application-record,
appeal and audit-log deletion still need policy decisions. Run the emulator
suite before any approved deployment.
