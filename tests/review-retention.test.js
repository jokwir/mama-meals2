const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const workflow = require("../functions/application-workflow");
const review = require("../functions/review-workflow");
const retention = require("../functions/retention-workflow");

let app;
let db;

function uid() { return `review-${randomUUID().replace(/-/g, "")}`; }
function admin() { return { uid: "test-admin", token: { admin: true, email_verified: true } }; }
function fakeAuth() {
  const claims = new Map();
  return {
    claims,
    async getUser(id) { return { customClaims: claims.get(id) || {} }; },
    async setCustomUserClaims(id, value) { claims.set(id, value); }
  };
}

async function submitted(type, fields = {}) {
  const user = { uid: uid() };
  const draft = await workflow.startDraft(db, { getFiles: async () => [[]] }, user, type, fields);
  await workflow.submitDraft(db, user, draft.applicationId, async () => [], "REF-TEST");
  return { user, applicationId: draft.applicationId };
}

before(async () => {
  app = initializeApp({ projectId: "demo-mama-meals-review-retention" }, `review-${process.pid}`);
  db = getFirestore(app);
  await db.doc("adminSecurity/global").set({ enabled: true, bootstrapEnabled: false, blockedUids: [] });
});

after(async () => { await deleteApp(app); });

for (const boundary of ["afterReservation", "afterFirestoreCommit", "afterClaimSync"]) {
  test(`approval resumes safely after a crash at ${boundary}`, async () => {
    const { user, applicationId } = await submitted("cook", {
      businessName: "Test Kilimani Kitchen", serviceArea: "Kilimani",
      fullName: "Private applicant name", experience: "Private application review notes"
    });
    const auth = fakeAuth();
    await review.reserveReview(db, admin(), applicationId, "approved");
    await assert.rejects(review.finishReview(db, auth, applicationId, {}, async (at) => {
      if (at === boundary) throw new Error("simulated crash");
    }), /simulated crash/);
    const interim = (await db.doc(`applications/${applicationId}`).get()).data();
    assert.equal(interim.reviewNeedsReconcile, true);
    if (boundary === "afterReservation") assert.equal(interim.status, "reviewing");
    if (boundary === "afterFirestoreCommit") assert.equal(auth.claims.get(user.uid)?.vendor, undefined);
    const recovered = await review.finishReview(db, auth, applicationId);
    assert.equal(recovered.status, "approved");
    assert.equal(auth.claims.get(user.uid).vendor, true);
    assert.equal((await db.doc(`vendors/${user.uid}`).get()).data().status, "approved");
    const vendorRef = db.doc(`vendors/${user.uid}`);
    const vendor = (await vendorRef.get()).data();
    assert.equal(vendor.kitchenName, "Test Kilimani Kitchen");
    assert.equal(vendor.serviceArea, "Kilimani");
    assert.equal(JSON.stringify(vendor).includes("Private"), false);
    assert.equal(vendor.acceptingOrders, false);
    await vendorRef.update({ kitchenName: "Updated Kitchen", acceptingOrders: true });
    assert.equal((await db.doc(`applications/${applicationId}`).get()).data().reviewNeedsReconcile, false);
    assert.deepEqual(await review.finishReview(db, auth, applicationId), recovered);
    assert.equal((await vendorRef.get()).data().kitchenName, "Updated Kitchen");
    assert.equal((await vendorRef.get()).data().acceptingOrders, true);
    await review.reserveReview(db, admin(), applicationId, "approved");
    await assert.rejects(review.reserveReview(db, admin(), applicationId, "declined"), /different decision/);
  });
}

test("a failed Auth claim write is reconciled without premature role access", async () => {
  const { user, applicationId } = await submitted("rider");
  const auth = fakeAuth();
  let fail = true;
  const setClaims = auth.setCustomUserClaims.bind(auth);
  auth.setCustomUserClaims = async (...args) => {
    if (fail) { fail = false; throw new Error("Auth unavailable"); }
    return setClaims(...args);
  };
  await review.reserveReview(db, admin(), applicationId, "approved");
  await assert.rejects(review.finishReview(db, auth, applicationId), /Auth unavailable/);
  assert.equal((await db.doc(`applications/${applicationId}`).get()).data().reviewNeedsReconcile, true);
  assert.equal(auth.claims.get(user.uid)?.rider, undefined);
  assert.equal((await review.reconcileReviews(db, auth)).recovered >= 1, true);
  assert.equal(auth.claims.get(user.uid).rider, true);
});

test("decline replay and reconciliation never grant a role", async () => {
  const { user, applicationId } = await submitted("rider");
  const auth = fakeAuth();
  await review.reserveReview(db, admin(), applicationId, "declined");
  await assert.rejects(review.finishReview(db, auth, applicationId, {}, async (at) => {
    if (at === "afterFirestoreCommit") throw new Error("simulated crash");
  }), /simulated crash/);
  assert.equal((await review.finishReview(db, auth, applicationId)).status, "declined");
  assert.equal(auth.claims.get(user.uid), undefined);
  await review.reserveReview(db, admin(), applicationId, "declined");
  await assert.rejects(review.reserveReview(db, admin(), applicationId, "approved"), /different decision/);
});

test("retention is disabled until configured and rejects invalid periods", () => {
  assert.deepEqual(retention.configuredRetentionDays({}), {});
  assert.deepEqual(retention.configuredRetentionDays({ APPLICATION_APPROVED_RETENTION_DAYS: "7" }), { approved: 7 });
  assert.throws(() => retention.configuredRetentionDays({ APPLICATION_DECLINED_RETENTION_DAYS: "0" }), /must be an integer/);
  assert.throws(() => retention.configuredRetentionDays({ APPLICATION_APPROVED_RETENTION_DAYS: "1e2" }), /must be an integer/);
  assert.throws(() => retention.configuredRetentionDays({ APPLICATION_APPROVED_RETENTION_DAYS: " 7" }), /must be an integer/);
  assert.throws(() => retention.configuredRetentionDays({ APPLICATION_APPROVED_IDENTITY_RETENTION_DAYS: "7" }), /All approved document classes/);
  assert.deepEqual(retention.configuredRetentionDays({
    APPLICATION_APPROVED_RETENTION_DAYS: "7", APPLICATION_APPROVED_FOOD_SAFETY_RETENTION_DAYS: "14"
  }), { approved: 7, byField: { approved: { foodSafety: 14 } } });
  assert.equal(retention.missingRetentionClasses({ approved: 7, declined: 30 }).length, 0);
  assert.equal(retention.missingRetentionClasses({ approved: 7 }).length, 4);
  assert.equal(retention.configuredRecordMinimizationDays({}), undefined);
  assert.equal(retention.configuredRecordMinimizationDays({ APPLICATION_RECORD_MINIMIZE_DAYS_AFTER_PURGE: "2" }), 2);
  assert.throws(() => retention.configuredRecordMinimizationDays({ APPLICATION_RECORD_MINIMIZE_DAYS_AFTER_PURGE: "0" }), /integer/);
});

test("explicit test-period minimization removes raw fields only after private files are purged", async () => {
  const { user, applicationId } = await submitted("rider");
  const ref = db.doc(`applications/${applicationId}`);
  const path = workflow.objectPath(user.uid, applicationId, "rider", "identityPhoto");
  const nowMs = Date.now();
  await ref.update({
    status: "approved", reference: "REF-MINIMIZE", fields: {
      fullName: "Private Name", phone: "Private Phone", registrationPlate: "Private Plate"
    },
    documents: [{ field: "identityPhoto", path, generation: "7" }],
    noticeConfirmedAt: new Date(nowMs - 20 * 86400000),
    documentCleanupPending: true, documentsPurgeAt: new Date(nowMs - 1000),
    recordMinimizePending: true, recordMinimizeAt: new Date(nowMs - 1000)
  });
  await assert.rejects(retention.minimizeApplicationRecord(db, applicationId, nowMs), /documents are not fully purged/);
  const deleted = [];
  const bucket = { file(name, options) { return { async delete() { deleted.push({ name, generation: options.generation }); } }; } };
  assert.equal(await retention.purgeSubmittedFiles(db, bucket, applicationId, nowMs, 1), true);
  assert.deepEqual(deleted, [{ name: path, generation: "7" }]);
  assert.equal(await retention.minimizeApplicationRecord(db, applicationId, nowMs), false);
  assert.equal(await retention.minimizeApplicationRecord(db, applicationId, nowMs + 86400000 + 1), false);
  const final = (await ref.get()).data();
  assert.equal(final.fields, undefined);
  assert.equal(final.documents, undefined);
  assert.equal(final.uploadAttempts, undefined);
  assert.equal(final.userId, user.uid);
  assert.equal(final.type, "rider");
  assert.equal(final.status, "approved");
  assert.equal(final.reference, "REF-MINIMIZE");
  assert.ok(final.submittedAt);
  assert.ok(final.documentsPurgedAt);
  assert.ok(final.recordMinimizedAt);
  assert.equal(await retention.minimizeApplicationRecord(db, applicationId, nowMs + 2 * 86400000), false);
});

test("an approved review schedules retention only when a period is configured", async () => {
  const { applicationId } = await submitted("cook");
  const auth = fakeAuth();
  await review.reserveReview(db, admin(), applicationId, "approved");
  await review.finishReview(db, auth, applicationId, { approved: 7 });
  const application = (await db.doc(`applications/${applicationId}`).get()).data();
  assert.equal(application.documentCleanupPending, true);
  assert.ok(application.documentsPurgeAt.toMillis() > Date.now());
  assert.equal(application.documentNextAttemptAt.toMillis(), application.documentsPurgeAt.toMillis());
});

test("declined rider plate and identity deadlines can differ without selecting a default", () => {
  const policy = retention.configuredRetentionDays({
    APPLICATION_DECLINED_RETENTION_DAYS: "30",
    APPLICATION_DECLINED_VEHICLE_RETENTION_DAYS: "7"
  });
  const documents = [{ field: "identityPhoto" }, { field: "vehiclePhoto" }];
  const scheduled = retention.scheduleDocuments(documents, "declined", policy, 1000000);
  assert.equal(scheduled.documents[0].purgeAt.toMillis(), 1000000 + 30 * 86400000);
  assert.equal(scheduled.documents[1].purgeAt.toMillis(), 1000000 + 7 * 86400000);
  assert.equal(scheduled.nextPurgeAt.toMillis(), scheduled.documents[1].purgeAt.toMillis());
  assert.deepEqual(retention.configuredRetentionDays({}), {});
});

test("retention retries partial failure and never follows a forged cross-application path", async () => {
  const user = uid();
  const firstId = `App${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const secondId = `App${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const idPath = workflow.objectPath(user, firstId, "rider", "identityPhoto");
  const platePath = workflow.objectPath(user, firstId, "rider", "vehiclePhoto");
  const otherPath = workflow.objectPath(user, secondId, "rider", "identityPhoto");
  const menuPath = `vendors/${user}/menu/MenuItem123/photo.jpg`;
  const objects = new Set([idPath, platePath, otherPath, menuPath]);
  let failPlate = true;
  const bucket = {
    file(path, options) {
      assert.equal(options?.generation, "7");
      return { async delete() {
        if (path === platePath && failPlate) { failPlate = false; throw new Error("Storage unavailable"); }
        objects.delete(path);
      } };
    }
  };
  const ref = db.doc(`applications/${firstId}`);
  const documents = [idPath, platePath].map((path, index) => ({
    field: index ? "vehiclePhoto" : "identityPhoto", path, generation: "7"
  }));
  await ref.set({ userId: user, type: "rider", status: "approved", documents,
    noticeConfirmedAt: new Date(Date.now() - 20 * 86400000),
    documentCleanupPending: true, documentsPurgeAt: new Date(Date.now() - 1000) });
  await assert.rejects(retention.purgeSubmittedFiles(db, bucket, firstId), /Storage unavailable/);
  assert.equal((await ref.get()).data().documentCleanupPending, true);
  assert.equal(objects.has(otherPath), true);
  await ref.update({ documents: [{ ...documents[0], path: otherPath }, documents[1]] });
  await assert.rejects(retention.purgeSubmittedFiles(db, bucket, firstId), /path or generation mismatch/);
  assert.equal(objects.has(otherPath), true);
  await ref.update({ documents });
  assert.equal(await retention.purgeSubmittedFiles(db, bucket, firstId), true);
  assert.equal((await ref.get()).data().documentCleanupPending, false);
  assert.equal((await ref.get()).data().documents, undefined);
  assert.equal(objects.has(otherPath), true);
  assert.equal(objects.has(menuPath), true);
  assert.equal(await retention.purgeSubmittedFiles(db, bucket, firstId), false);
});

test("retention validates the entire manifest before deleting any object", async () => {
  const user = uid();
  const applicationId = `App${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const ownPath = workflow.objectPath(user, applicationId, "rider", "identityPhoto");
  const otherPath = workflow.objectPath(user, `Other${applicationId}`, "rider", "vehiclePhoto");
  const deleted = [];
  const bucket = { file(path) { return { async delete() { deleted.push(path); } }; } };
  const ref = db.doc(`applications/${applicationId}`);
  const first = { field: "identityPhoto", path: ownPath, generation: "7" };
  await ref.set({ userId: user, type: "rider", status: "declined",
    documents: [first, { field: "vehiclePhoto", path: otherPath, generation: "8" }],
    noticeConfirmedAt: new Date(Date.now() - 20 * 86400000),
    documentCleanupPending: true, documentsPurgeAt: new Date(Date.now() - 1000) });
  await assert.rejects(retention.purgeSubmittedFiles(db, bucket, applicationId), /path or generation mismatch/);
  assert.deepEqual(deleted, []);
  await ref.update({ documents: [first, first] });
  await assert.rejects(retention.purgeSubmittedFiles(db, bucket, applicationId), /Duplicate application/);
  assert.deepEqual(deleted, []);
});

test("independent cook document deadlines purge only due generations and retry safely", async () => {
  const { user, applicationId } = await submitted("cook");
  const fields = ["identityDocument", "foodSafetyDocument", "foodPhoto"];
  const paths = fields.map((field) => workflow.objectPath(user.uid, applicationId, "cook", field));
  const documents = fields.map((field, index) => ({ field, path: paths[index], generation: "7" }));
  const ref = db.doc(`applications/${applicationId}`);
  await ref.update({ documents });
  const auth = fakeAuth();
  const policy = retention.configuredRetentionDays({
    APPLICATION_APPROVED_RETENTION_DAYS: "1",
    APPLICATION_APPROVED_FOOD_SAFETY_RETENTION_DAYS: "3",
    APPLICATION_APPROVED_FOOD_PHOTO_RETENTION_DAYS: "2"
  });
  await review.reserveReview(db, admin(), applicationId, "approved");
  await review.finishReview(db, auth, applicationId, policy);
  const initial = (await ref.get()).data();
  assert.equal(initial.documents.length, 3);
  assert.ok(initial.documents[0].purgeAt.toMillis() < initial.documents[2].purgeAt.toMillis());
  assert.ok(initial.documents[2].purgeAt.toMillis() < initial.documents[1].purgeAt.toMillis());
  const objects = new Set(paths);
  const bucket = { file(path, options) {
    assert.equal(options.generation, "7");
    return { async delete() { objects.delete(path); } };
  } };
  const afterIdentity = initial.documents[0].purgeAt.toMillis() + 1000;
  await ref.update({ noticeConfirmedAt: new Date(afterIdentity - 20 * 86400000) });
  assert.equal(await retention.purgeSubmittedFiles(db, bucket, applicationId, afterIdentity), true);
  assert.equal(objects.has(paths[0]), false);
  assert.equal(objects.has(paths[1]), true);
  assert.equal(objects.has(paths[2]), true);
  assert.deepEqual((await ref.get()).data().documents.map((item) => item.field), fields.slice(1));
  assert.equal(await retention.purgeSubmittedFiles(db, bucket, applicationId, afterIdentity), false);
  const afterAll = initial.documents[1].purgeAt.toMillis() + 1000;
  assert.equal(await retention.purgeSubmittedFiles(db, bucket, applicationId, afterAll), true);
  assert.equal(objects.size, 0);
  assert.equal((await ref.get()).data().documentCleanupPending, false);
});
