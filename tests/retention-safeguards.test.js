const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
const { getFirestore, Timestamp } = functionsRequire("firebase-admin/firestore");
const workflow = require("../functions/application-workflow");
const retention = require("../functions/retention-workflow");
const protection = require("../functions/application-protection");

const day = 86400000;
const owner = () => ({ uid: `owner${randomUUID().replace(/-/g, "")}`, token: { email_verified: true } });
const admin = () => ({ uid: "retention-admin", token: { admin: true, email_verified: true } });
const policy = retention.configuredRetentionDays({
  APPLICATION_APPROVED_IDENTITY_RETENTION_DAYS: "7",
  APPLICATION_APPROVED_FOOD_SAFETY_RETENTION_DAYS: "30",
  APPLICATION_APPROVED_VEHICLE_RETENTION_DAYS: "7",
  APPLICATION_APPROVED_FOOD_PHOTO_RETENTION_DAYS: "7",
  APPLICATION_DECLINED_IDENTITY_RETENTION_DAYS: "30",
  APPLICATION_DECLINED_FOOD_SAFETY_RETENTION_DAYS: "30",
  APPLICATION_DECLINED_VEHICLE_RETENTION_DAYS: "30",
  APPLICATION_DECLINED_FOOD_PHOTO_RETENTION_DAYS: "30"
});
let app;
let db;

function bucket(paths, onDelete = async () => {}) {
  return { file(path, options) { return { async delete() {
    assert.equal(options.generation, "7");
    await onDelete(path);
    paths.delete(path);
  } }; } };
}

async function decided({ type = "cook", status = "approved", fields = ["identityDocument"],
  at = Date.now() - 40 * day, notice = true } = {}) {
  const user = owner();
  const id = `App${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const raw = fields.map((field) => ({ field, path: workflow.objectPath(user.uid, id, type, field), generation: "7" }));
  const scheduled = retention.scheduleDocuments(raw, status, policy, at);
  const ref = db.doc(`applications/${id}`);
  await ref.set({ userId: user.uid, type, status, reference: "MM-TEST", fields: { fullName: "TEST ONLY", phone: "TEST ONLY" },
    documents: scheduled.documents, documentCleanupPending: true,
    documentsPurgeAt: scheduled.nextPurgeAt, documentNextAttemptAt: scheduled.nextPurgeAt,
    reviewedAt: Timestamp.fromMillis(at), submittedAt: Timestamp.fromMillis(at - day),
    ...(notice ? { noticeConfirmedAt: Timestamp.fromMillis(at) } : {}) });
  const paths = new Set(raw.map((doc) => doc.path));
  return { user, id, ref, paths, bucket: bucket(paths) };
}

before(() => {
  app = initializeApp({ projectId: "demo-mama-meals-storage-rules" }, `safeguards-${process.pid}`);
  db = getFirestore(app);
});
after(async () => { await deleteApp(app); });

test("all eight local policy classes are independent and recognized", () => {
  assert.deepEqual(retention.missingRetentionClasses(policy), []);
  assert.equal(policy.byField.approved.identity, 7);
  assert.equal(policy.byField.approved.foodSafety, 30);
  assert.equal(policy.byField.approved.vehicle, 7);
  assert.equal(policy.byField.approved.foodPhoto, 7);
  for (const days of Object.values(policy.byField.declined)) assert.equal(days, 30);
});

test("an open appeal blocks only another application for the same role", async () => {
  const item = await decided({ status: "declined", at: Date.now() - day });
  await protection.requestAppeal(db, item.user, item.id);
  const emptyBucket = { async getFiles() { return [[]]; } };
  await assert.rejects(workflow.startDraft(db, emptyBucket, item.user, "cook", {}),
    /open appeal|already pending or approved/);
  const rider = await workflow.startDraft(db, emptyBucket, item.user, "rider", {});
  assert.equal(rider.type, "rider");
  await protection.finishAppeal(db, admin(), item.id, "upheld");
  const cook = await workflow.startDraft(db, emptyBucket, item.user, "cook", {});
  assert.equal(cook.type, "cook");
});

test("approved identity, private food photo and vehicle purge at seven days but not before", async () => {
  const at = Date.now() - 10 * day;
  for (const [type, fields] of [["cook", ["identityDocument", "foodPhoto"]], ["rider", ["identityPhoto", "vehiclePhoto"]]]) {
    const item = await decided({ type, fields, at });
    assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, at + 7 * day - 1), false);
    assert.equal(item.paths.size, fields.length);
    assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, at + 7 * day), true);
    assert.equal(item.paths.size, 0);
    const saved = (await item.ref.get()).data();
    assert.equal(saved.fields, undefined);
    assert.equal(saved.documents, undefined);
    assert.equal(saved.userId, item.user.uid);
    assert.equal(saved.reference, "MM-TEST");
    assert.ok(saved.documentClassDeletedAt.identity);
  }
});

test("approved food-safety document survives day seven and purges at day thirty", async () => {
  const at = Date.now() - 35 * day;
  const item = await decided({ fields: ["identityDocument", "foodSafetyDocument", "foodPhoto"], at });
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, at + 7 * day), true);
  assert.equal(item.paths.size, 1);
  assert.equal((await item.ref.get()).data().documents[0].field, "foodSafetyDocument");
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, at + 30 * day - 1), false);
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, at + 30 * day), true);
  assert.equal(item.paths.size, 0);
  assert.ok((await item.ref.get()).data().documentClassDeletedAt.foodSafety);
});

test("declined document classes purge at thirty days, not before", async () => {
  const at = Date.now() - 35 * day;
  const item = await decided({ status: "declined", fields: ["identityDocument", "foodSafetyDocument", "foodPhoto"], at });
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, at + 30 * day - 1), false);
  assert.equal(item.paths.size, 3);
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, at + 30 * day), true);
  assert.equal(item.paths.size, 0);
  const rider = await decided({ type: "rider", status: "declined", fields: ["identityPhoto", "vehiclePhoto"], at });
  assert.equal(await retention.purgeSubmittedFiles(db, rider.bucket, rider.id, at + 30 * day), true);
  assert.equal(rider.paths.size, 0);
});

test("unconfirmed notice blocks deletion and starts the declined appeal window only on confirmation", async () => {
  const at = Date.now() - 40 * day;
  const item = await decided({ status: "declined", at, notice: false });
  const now = at + 40 * day;
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, now), false);
  assert.equal(item.paths.size, 1);
  assert.equal((await item.ref.get()).data().documentNextAttemptAt, undefined);
  assert.equal((await item.ref.get()).data().documentRetentionBlockedReason, "notice-unconfirmed");
  await assert.rejects(protection.confirmNotice(db, item.user, item.id, "delivered-email", now), /admin access/);
  await assert.rejects(protection.confirmNotice(db, admin(), item.id, "verified-email", now), /delivery confirmation is unavailable/);
  await db.doc(`applicationNoticeReceipts/${item.id}`).set({ recipientUid: item.user.uid,
    channelCode: "verified-email", revision: 1, sendAttemptAt: Timestamp.fromMillis(now) });
  await assert.rejects(protection.confirmNotice(db, admin(), item.id, "verified-email", now), /delivery confirmation is unavailable/);
  await db.doc(`applicationNoticeReceipts/${item.id}`).update({
    deliveryEvidenceCode: "provider-confirmed", confirmedAt: Timestamp.fromMillis(now)
  });
  assert.equal((await protection.confirmNotice(db, admin(), item.id, "verified-email", now)).alreadyConfirmed, false);
  assert.equal((await protection.confirmNotice(db, admin(), item.id, "verified-email", now)).alreadyConfirmed, true);
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, now + 13 * day), false);
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, now + 14 * day), true);
});

test("open appeal crosses normal deadline and completion does not restart retention", async () => {
  const at = Date.now() - 35 * day;
  const item = await decided({ status: "declined", at });
  await assert.rejects(protection.requestAppeal(db, owner(), item.id, at + 10 * day), /access denied/);
  assert.equal((await protection.requestAppeal(db, item.user, item.id, at + 13 * day)).status, "open");
  assert.equal((await protection.requestAppeal(db, item.user, item.id, at + 13 * day)).alreadyOpen, true);
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, at + 35 * day), false);
  assert.equal(item.paths.size, 1);
  assert.equal((await item.ref.get()).data().documentNextAttemptAt, undefined);
  await assert.rejects(protection.finishAppeal(db, item.user, item.id, "upheld", at + 35 * day), /admin access/);
  await protection.finishAppeal(db, admin(), item.id, "upheld", at + 35 * day);
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id, at + 35 * day), true);
  assert.equal((await item.ref.get()).data().appealHistory.length, 1);
});

test("appeal requests close after fourteen days and carry a seven-day response target", async () => {
  const at = Date.now() - 20 * day;
  const item = await decided({ status: "declined", at });
  await assert.rejects(protection.requestAppeal(db, item.user, item.id, at + 14 * day + 1), /window has closed/);
  await protection.requestAppeal(db, item.user, item.id, at + 14 * day);
  const appeal = (await item.ref.get()).data().appeal;
  assert.equal(appeal.responseDueAt.toMillis(), at + 21 * day);
  await assert.rejects(protection.finishAppeal(db, admin(), item.id, "overturned", at + 15 * day), /separate trusted review workflow/);
});

test("active dispute pauses deletion and resolution uses original deadline", async () => {
  const item = await decided();
  await protection.setDispute(db, admin(), item.id, "open", "active-dispute");
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id), false);
  assert.equal(item.paths.size, 1);
  assert.equal((await item.ref.get()).data().documentNextAttemptAt, undefined);
  await protection.setDispute(db, admin(), item.id, "close", "resolved");
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id), true);
  assert.equal((await item.ref.get()).data().disputeHistory.length, 1);
});

test("legal hold requires scope, reason, owner and review date; review and release are explicit", async () => {
  const item = await decided();
  await assert.rejects(protection.setLegalHold(db, item.user, item.id, "place", { reasonCode: "court-request", scope: "all", reviewDueAtMs: Date.now() + day }), /admin access/);
  await assert.rejects(protection.setLegalHold(db, admin(), item.id, "place", { reasonCode: "court-request", scope: "all" }), /review date/);
  await protection.setLegalHold(db, admin(), item.id, "place", { reasonCode: "court-request", scope: "all", reviewDueAtMs: Date.now() + day });
  const held = (await item.ref.get()).data().legalHold;
  assert.equal(held.scope, "all");
  assert.equal(held.reasonCode, "court-request");
  assert.equal(held.responsibleUid, admin().uid);
  assert.ok(held.reviewDueAt);
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id), false);
  await protection.setLegalHold(db, admin(), item.id, "review", { reasonCode: "still-required", scope: "all", reviewDueAtMs: Date.now() + 2 * day });
  await protection.setLegalHold(db, admin(), item.id, "release", { reasonCode: "matter-closed" });
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id), true);
  assert.equal((await item.ref.get()).data().legalHoldHistory.length, 1);
});

test("overdue legal holds generate bounded review alerts and never auto-release", async () => {
  const at = Date.now() - 30 * day;
  const item = await decided({ at });
  await protection.setLegalHold(db, admin(), item.id, "place", {
    reasonCode: "court-request", scope: "all", reviewDueAtMs: at + day
  }, at);
  for (let reminder = 1; reminder <= 3; reminder += 1) {
    assert.equal((await protection.flagOverdueLegalHolds(db, at + day + (reminder - 1) * 7 * day)).flagged >= 1, true);
  }
  const record = (await item.ref.get()).data();
  assert.equal(record.legalHold.status, "active");
  assert.equal(record.legalHoldReviewReminders, 3);
  assert.equal(record.legalHoldReviewManual, true);
  assert.equal(record.legalHoldReviewNextAt, undefined);
  assert.equal(await retention.purgeSubmittedFiles(db, item.bucket, item.id), false);
  await protection.setLegalHold(db, admin(), item.id, "release", { reasonCode: "matter-closed" });
  assert.equal((await item.ref.get()).data().legalHoldReviewManual, false);
});

test("hold and appeal updates serialize with a worker lease", async () => {
  const item = await decided({ status: "declined" });
  let entered;
  const deleting = new Promise((resolve) => { entered = resolve; });
  let resume;
  const paused = new Promise((resolve) => { resume = resolve; });
  const slowBucket = bucket(item.paths, async () => { entered(); await paused; });
  const work = retention.purgeSubmittedFiles(db, slowBucket, item.id);
  await deleting;
  await assert.rejects(protection.setLegalHold(db, admin(), item.id, "place", {
    reasonCode: "court-request", scope: "all", reviewDueAtMs: Date.now() + day
  }), /deletion is in progress/);
  await assert.rejects(protection.requestAppeal(db, item.user, item.id), /deletion is in progress/);
  resume();
  assert.equal(await work, true);
  assert.equal((await item.ref.get()).data().documentDeletionLease, undefined);
});

test("stale worker state and already-deleted generations are safe on retry", async () => {
  const item = await decided();
  let failures = 0;
  const flaky = { file(path, options) { return { async delete() {
    if (failures++ === 0) throw new Error("transient-storage-error");
    assert.equal(options.generation, "7");
    item.paths.delete(path);
  } }; } };
  await assert.rejects(retention.purgeSubmittedFiles(db, flaky, item.id), /transient-storage-error/);
  assert.equal((await item.ref.get()).data().documentDeletionLease, undefined);
  assert.equal(await retention.purgeSubmittedFiles(db, flaky, item.id), true);
  assert.equal(await retention.purgeSubmittedFiles(db, flaky, item.id), false);
  const stale = await decided();
  const staleBucket = bucket(stale.paths, async () => {
    await stale.ref.update({ documents: [{ field: "identityDocument", path: "applications/another/unsafe", generation: "7" }] });
  });
  assert.equal(await retention.purgeSubmittedFiles(db, staleBucket, stale.id), false);
  assert.equal((await stale.ref.get()).data().documentCleanupPending, true);
});

test("an already-missing exact object generation is idempotently recorded as deleted", async () => {
  const item = await decided();
  let deletes = 0;
  const missingBucket = { file(path, options) { return { async delete(request) {
    assert.equal(path, [...item.paths][0]);
    assert.equal(options.generation, "7");
    assert.equal(request.ignoreNotFound, true);
    deletes += 1;
  } }; } };
  assert.equal(await retention.purgeSubmittedFiles(db, missingBucket, item.id), true);
  assert.equal((await item.ref.get()).data().documentCleanupPending, false);
  assert.equal(await retention.purgeSubmittedFiles(db, missingBucket, item.id), false);
  assert.equal(deletes, 1);
});

test("pending applications are flagged for review but never purged as abandoned drafts", async () => {
  const user = owner();
  const fakeBucket = { getFiles: async () => [[]] };
  const draft = await workflow.startDraft(db, fakeBucket, user, "cook", {});
  await workflow.submitDraft(db, user, draft.applicationId, async () => [], "REF-PENDING");
  const ref = db.doc(`applications/${draft.applicationId}`);
  const alertAt = (await ref.get()).data().pendingReviewAlertAt.toMillis();
  await workflow.flagPendingApplications(db, alertAt + 1);
  assert.ok((await ref.get()).data().pendingReviewFlaggedAt);
  assert.equal((await ref.get()).data().status, "pending");
  await workflow.cleanupAbandonedDrafts(db, fakeBucket, alertAt + 2);
  assert.equal((await ref.get()).data().status, "pending");
});
