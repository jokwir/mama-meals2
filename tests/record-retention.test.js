const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
const { getFirestore, Timestamp } = functionsRequire("firebase-admin/firestore");
const records = require("../functions/record-retention");
const accessLogs = require("../functions/audit-retention");
const protection = require("../functions/application-protection");

const day = 86400000;
const admin = { uid: "record-reviewer", token: { admin: true, email_verified: true } };
let app;
let db;
function newId() { return `App${randomUUID().replace(/-/g, "").slice(0, 24)}`; }
function stamp(ms) { return Timestamp.fromMillis(ms); }

async function fixture(status, at, extra = {}) {
  const id = newId();
  const userId = `owner${randomUUID().replace(/-/g, "")}`;
  const ref = db.doc(`applications/${id}`);
  const data = { userId, type: "cook", status, reference: "REF-LOCAL",
    fields: { fullName: "DO NOT KEEP" }, ...extra };
  const deadline = records.recordDeadlineMs(data);
  if (deadline !== null) data.recordPurgeAt = stamp(deadline);
  await ref.set(data);
  return { id, ref, userId, deadline, at };
}

before(() => {
  app = initializeApp({ projectId: "demo-mama-meals-storage-rules" }, `records-${process.pid}`);
  db = getFirestore(app);
});
after(async () => { await deleteApp(app); });

test("cleaned draft record expires at 30 days, not before; pending never expires", async () => {
  const at = Date.now() - 40 * day;
  const draft = await fixture("expired", at, { cleanupPending: false, cleanupAt: stamp(at) });
  assert.equal(draft.deadline, at + 30 * day);
  assert.equal(await records.purgeApplicationRecord(db, draft.id, draft.deadline - 1), false);
  assert.equal(await records.purgeApplicationRecord(db, draft.id, draft.deadline), true);
  assert.equal((await draft.ref.get()).exists, false);
  const pending = await fixture("pending", at, { submittedAt: stamp(at) });
  assert.equal(pending.deadline, null);
  assert.equal(await records.purgeApplicationRecord(db, pending.id, at + 1000 * day), false);
  assert.equal((await pending.ref.get()).exists, true);
});

test("declined record expires 180 days after final appeal window or closure", async () => {
  const at = Date.now() - 220 * day;
  const base = { reviewedAt: stamp(at), noticeConfirmedAt: stamp(at),
    documentsPurgedAt: stamp(at + 30 * day), documentCleanupPending: false };
  const item = await fixture("declined", at, base);
  assert.equal(item.deadline, at + 14 * day + 180 * day);
  await item.ref.collection("events").doc("initial-decision").set({ decision: "declined" });
  await db.doc(`applicationNoticeReceipts/${item.id}`).set({ channelCode: "verified-email" });
  assert.equal(await records.purgeApplicationRecord(db, item.id, item.deadline - 1), false);
  assert.equal(await records.purgeApplicationRecord(db, item.id, item.deadline), true);
  assert.equal((await item.ref.collection("events").doc("initial-decision").get()).exists, false);
  assert.equal((await db.doc(`applicationNoticeReceipts/${item.id}`).get()).exists, false);
  const appealed = await fixture("declined", at, { ...base,
    appeal: { status: "closed", closedAt: stamp(at + 40 * day) } });
  assert.equal(appealed.deadline, at + 40 * day + 180 * day);
  assert.equal(await records.purgeApplicationRecord(db, appealed.id, appealed.deadline), true);
});

test("active appeal, dispute and legal hold pause record deletion without inventing a new clock", async () => {
  const at = Date.now() - 230 * day;
  const base = { reviewedAt: stamp(at), noticeConfirmedAt: stamp(at),
    documentsPurgedAt: stamp(at + 30 * day), documentCleanupPending: false };
  for (const protectionField of ["appeal", "dispute", "legalHold"]) {
    const item = await fixture("declined", at, base);
    const value = protectionField === "legalHold" ? { status: "active" } : { status: "open" };
    await item.ref.update({ [protectionField]: value });
    assert.equal(await records.purgeApplicationRecord(db, item.id, Date.now()), false);
    assert.equal((await item.ref.get()).exists, true);
  }
  const held = await fixture("declined", at, { ...base, legalHold: { status: "active" } });
  await protection.setLegalHold(db, admin, held.id, "release", { reasonCode: "case-closed" });
  assert.equal((await held.ref.get()).data().recordPurgeAt.toMillis(), at + 14 * day + 180 * day);
  assert.equal(await records.purgeApplicationRecord(db, held.id, Date.now()), true);
});

test("approved record stays while active and waits 180 days after trusted offboarding and claim revocation", async () => {
  const at = Date.now() - 200 * day;
  const base = { documentsPurgedAt: stamp(at), documentCleanupPending: false };
  const active = await fixture("approved", at, base);
  assert.equal(active.deadline, null);
  const offboarded = await fixture("approved", at, { ...base,
    offboarding: { status: "complete", offboardedAt: stamp(at), claimRevokedAt: stamp(at + day) } });
  assert.equal(offboarded.deadline, at + 180 * day);
  assert.equal(await records.purgeApplicationRecord(db, offboarded.id, offboarded.deadline - 1), false);
  assert.equal(await records.purgeApplicationRecord(db, offboarded.id, offboarded.deadline), true);
});

test("private document preview events wait for case closure and last access", async () => {
  const at = Date.now() - 210 * day;
  const pending = await fixture("pending", at, { submittedAt: stamp(at) });
  const pendingLog = db.collection("applicationDocumentAccess").doc();
  await pendingLog.set({ applicationId: pending.id, viewedAt: stamp(at),
    auditNextAttemptAt: stamp(at + 180 * day), reviewedBy: "test-reviewer", field: "identityDocument" });
  assert.equal(await accessLogs.purgeDocumentAccessEvent(db, pendingLog, Date.now()), false);
  assert.equal((await pendingLog.get()).exists, true);
  const declined = await fixture("declined", at, { reviewedAt: stamp(at),
    noticeConfirmedAt: stamp(at), documentsPurgedAt: stamp(at + 30 * day),
    documentCleanupPending: false });
  const late = at + 70 * day;
  const log = db.collection("applicationDocumentAccess").doc();
  await log.set({ applicationId: declined.id, viewedAt: stamp(late),
    auditNextAttemptAt: stamp(late + 180 * day), reviewedBy: "test-reviewer", field: "identityDocument" });
  assert.equal(await accessLogs.purgeDocumentAccessEvent(db, log, late + 180 * day - 1), false);
  assert.equal(await accessLogs.purgeDocumentAccessEvent(db, log, late + 180 * day), true);
  assert.equal((await log.get()).exists, false);
});

test("resolved maintenance failure is redacted and expires after 90 days", async () => {
  const now = Date.now();
  const item = await fixture("expired", now - 40 * day, {
    cleanupPending: false, cleanupAt: stamp(now - 40 * day),
    jobFailures: { "record-purge": { attempts: 2, code: "unavailable",
      lastAt: stamp(now - day), blocked: false } }
  });
  assert.equal(await records.purgeApplicationRecord(db, item.id, now), true);
  const history = await db.collection("applicationFailureHistory")
    .where("applicationId", "==", item.id).get();
  assert.equal(history.size, 1);
  assert.equal(history.docs[0].data().code, "unavailable");
  assert.equal(history.docs[0].data().attempts, 2);
  assert.equal(history.docs[0].data().fields, undefined);
  assert.equal((await accessLogs.purgeDueResolvedFailureEvents(db, now + 90 * day - 1)).purged, 0);
  assert.equal((await accessLogs.purgeDueResolvedFailureEvents(db, now + 90 * day + 10000)).purged >= 1, true);
  assert.equal((await history.docs[0].ref.get()).exists, false);
});
