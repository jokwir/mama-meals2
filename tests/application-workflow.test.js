const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp, getApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const workflow = require("../functions/application-workflow");
const { runtimeConfig } = require("../functions/runtime-config");
const { recordFailure } = require("../functions/job-failures");
const callableFunctions = require("../functions/index.js");

let app;
let db;
let sequence = 0;

function caller() {
  sequence += 1;
  return { uid: `workflow-user-${process.pid}-${sequence}` };
}

function fakeBucket() {
  const objects = new Set();
  let failDelete = false;
  return {
    objects,
    set failDelete(value) { failDelete = value; },
    async getFiles({ prefix }) {
      if (failDelete) throw new Error("Simulated Storage outage");
      return [[...objects].filter((name) => name.startsWith(prefix)).map((name) => ({
        name,
        async delete() { objects.delete(name); }
      }))];
    }
  };
}

before(() => {
  app = initializeApp({ projectId: "demo-mama-meals-application-workflow" }, `workflow-${process.pid}`);
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

test("server creates an owner-bound draft and replaces a partial retry safely", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const first = await workflow.startDraft(db, bucket, user, "cook", { fullName: "A" });
  const snapshot = await db.doc(`applications/${first.applicationId}`).get();
  assert.equal(snapshot.data().userId, user.uid);
  assert.equal(snapshot.data().status, "draft");
  assert.equal(snapshot.data().type, "cook");
  bucket.objects.add(workflow.objectPath(user.uid, first.applicationId, "cook", "identityDocument"));
  const second = await workflow.startDraft(db, bucket, user, "cook", { fullName: "B" });
  assert.notEqual(first.applicationId, second.applicationId);
  assert.equal((await db.doc(`applications/${first.applicationId}`).get()).data().status, "cancelled");
  assert.equal(bucket.objects.size, 0);
  assert.equal((await workflow.slotRef(db, user.uid, "cook").get()).data().applicationId, second.applicationId);
});

test("draft creation is atomically capped per verified account and day", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const original = process.env.APPLICATION_DRAFTS_PER_DAY;
  process.env.APPLICATION_DRAFTS_PER_DAY = "2";
  try {
    const first = await workflow.startDraft(db, bucket, user, "cook", {});
    const second = await workflow.startDraft(db, bucket, user, "cook", {});
    assert.notEqual(first.applicationId, second.applicationId);
    await assert.rejects(workflow.startDraft(db, bucket, user, "cook", {}), /Too many application attempts/);
    assert.equal((await workflow.usageRef(db, user.uid).get()).data().drafts, 2);
    assert.equal((await db.doc(`applications/${second.applicationId}`).get()).data().status, "draft");
  } finally {
    if (original === undefined) delete process.env.APPLICATION_DRAFTS_PER_DAY;
    else process.env.APPLICATION_DRAFTS_PER_DAY = original;
  }
});

test("concurrent draft requests leave one current slot and count both attempts", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const results = await Promise.all([
    workflow.startDraft(db, bucket, user, "cook", { fullName: "First" }),
    workflow.startDraft(db, bucket, user, "cook", { fullName: "Second" })
  ]);
  const currentId = (await workflow.slotRef(db, user.uid, "cook").get()).data().applicationId;
  assert.ok(results.some((item) => item.applicationId === currentId));
  const statuses = await Promise.all(results.map(async (item) =>
    (await db.doc(`applications/${item.applicationId}`).get()).data().status));
  assert.deepEqual(statuses.sort(), ["cancelled", "draft"]);
  assert.equal((await workflow.usageRef(db, user.uid).get()).data().drafts, 2);
});

test("operational limits and region reject malformed configuration", () => {
  assert.equal(runtimeConfig({}).region, "europe-west1");
  assert.equal(runtimeConfig({ FIREBASE_FUNCTIONS_REGION: "africa-south1" }).region, "africa-south1");
  assert.equal(runtimeConfig({ APPLICATION_FUNCTIONS_REGION: "africa-south1" }).region, "africa-south1");
  assert.equal(runtimeConfig({ APPLICATION_FUNCTIONS_REGION: "africa-south1", FIREBASE_FUNCTIONS_REGION: "europe-west1" }).region, "africa-south1");
  assert.throws(() => runtimeConfig({ FIREBASE_FUNCTIONS_REGION: "unknown" }), /Functions region/);
  assert.throws(() => runtimeConfig({ APPLICATION_DRAFTS_PER_DAY: "0" }), /positive integer/);
  assert.throws(() => runtimeConfig({ APPLICATION_UPLOADS_PER_DAY: "999999" }), /between/);
});

test("poisoned maintenance records stop automatic retries and retain a manual marker", async () => {
  const id = `Poison${process.pid}${++sequence}`;
  const ref = db.doc(`applications/${id}`);
  await ref.set({ status: "draft", expiryNextAttemptAt: new Date(Date.now() - 1000) });
  const original = process.env.APPLICATION_JOB_MAX_ATTEMPTS;
  process.env.APPLICATION_JOB_MAX_ATTEMPTS = "2";
  try {
    const first = await recordFailure(db, ref, "expiry", "expiryNextAttemptAt",
      (current) => current.status === "draft", Object.assign(new Error("private details"), { code: "bad/input" }));
    assert.equal(first.blocked, false);
    assert.ok((await ref.get()).data().expiryNextAttemptAt.toMillis() > Date.now());
    const second = await recordFailure(db, ref, "expiry", "expiryNextAttemptAt",
      (current) => current.status === "draft", new Error("private details"));
    assert.equal(second.blocked, true);
    const data = (await ref.get()).data();
    assert.equal(data.expiryNextAttemptAt, undefined);
    assert.equal(data.jobFailures.expiry.blocked, true);
    assert.equal(data.jobFailures.expiry.attempts, 2);
    assert.equal(JSON.stringify(data).includes("private details"), false);
  } finally {
    if (original === undefined) delete process.env.APPLICATION_JOB_MAX_ATTEMPTS;
    else process.env.APPLICATION_JOB_MAX_ATTEMPTS = original;
  }
});

test("stale cancelled-draft cleanup cannot delete a newer active applicant's files", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const old = await workflow.startDraft(db, bucket, user, "rider", {});
  const current = await workflow.startDraft(db, bucket, user, "rider", {});
  const oldPath = workflow.objectPath(user.uid, old.applicationId, "rider", "identityPhoto");
  const currentPath = workflow.objectPath(user.uid, current.applicationId, "rider", "identityPhoto");
  bucket.objects.add(oldPath);
  bucket.objects.add(currentPath);
  await db.doc(`applications/${old.applicationId}`).update({ finalCleanupAfter: new Date(Date.now() - 1000) });
  await workflow.cleanupAbandonedDrafts(db, bucket);
  assert.equal(bucket.objects.has(oldPath), false);
  assert.equal(bucket.objects.has(currentPath), true);
});

test("cross-user calls fail and repeated submission returns its original reference", async () => {
  const user = caller();
  const other = caller();
  const bucket = fakeBucket();
  const draft = await workflow.startDraft(db, bucket, user, "rider", { fullName: "R" });
  const verified = async () => [{ field: "identityPhoto" }, { field: "vehiclePhoto" }];
  await assert.rejects(workflow.submitDraft(db, other, draft.applicationId, verified, "REF-1"), /does not belong/);
  await assert.rejects(workflow.cancelDraft(db, bucket, other, draft.applicationId), /does not belong/);
  await workflow.submitDraft(db, user, draft.applicationId, verified, "REF-1");
  assert.equal((await workflow.slotRef(db, user.uid, "rider").get()).data().status, "pending");
  await assert.rejects(workflow.startDraft(db, bucket, user, "rider", {}), /already pending/);
  const replay = await workflow.submitDraft(db, user, draft.applicationId, verified, "REF-2");
  assert.equal(replay.reference, "REF-1");
  const uncertain = await workflow.cancelDraft(db, bucket, user, draft.applicationId);
  assert.equal(uncertain.status, "pending");
  assert.equal(uncertain.reference, "REF-1");
});

test("failed validation never submits; server cancellation deletes partial files", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const draft = await workflow.startDraft(db, bucket, user, "cook", {});
  bucket.objects.add(workflow.objectPath(user.uid, draft.applicationId, "cook", "foodPhoto"));
  await assert.rejects(workflow.submitDraft(db, user, draft.applicationId, async () => {
    throw new Error("Missing required upload");
  }, "REF-3"), /Missing required upload/);
  assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().status, "draft");
  await workflow.cancelDraft(db, bucket, user, draft.applicationId);
  assert.equal(bucket.objects.size, 0);
  assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().cleanupPending, true);
  const originalDeadline = (await db.doc(`applications/${draft.applicationId}`).get()).data().finalCleanupAfter.toMillis();
  await workflow.cancelDraft(db, bucket, user, draft.applicationId);
  assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().finalCleanupAfter.toMillis(), originalDeadline);
  await db.doc(`applications/${draft.applicationId}`).update({ finalCleanupAfter: new Date(Date.now() - 1000) });
  await workflow.cleanupAbandonedDrafts(db, bucket);
  assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().cleanupPending, false);
  await assert.rejects(workflow.submitDraft(db, user, draft.applicationId, async () => [], "REF-4"), /no longer open/);
});

test("cancelled draft stays cleanup-pending if Storage deletion fails after Firestore commit", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const draft = await workflow.startDraft(db, bucket, user, "rider", {});
  const path = workflow.objectPath(user.uid, draft.applicationId, "rider", "identityPhoto");
  bucket.objects.add(path);
  bucket.failDelete = true;
  await assert.rejects(workflow.cancelDraft(db, bucket, user, draft.applicationId), /Simulated Storage outage/);
  const ref = db.doc(`applications/${draft.applicationId}`);
  assert.equal((await ref.get()).data().status, "cancelled");
  assert.equal((await ref.get()).data().cleanupPending, true);
  assert.equal(bucket.objects.has(path), true);
  bucket.failDelete = false;
  await ref.update({ finalCleanupAfter: new Date(Date.now() - 1000) });
  await workflow.cleanupAbandonedDrafts(db, bucket);
  assert.equal(bucket.objects.has(path), false);
  assert.equal((await ref.get()).data().cleanupPending, false);
});

test("abandoned drafts expire and failed privileged cleanup can be retried", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const draft = await workflow.startDraft(db, bucket, user, "rider", {}, Date.now() - (2 * 24 * 60 * 60 * 1000));
  bucket.objects.add(workflow.objectPath(user.uid, draft.applicationId, "rider", "identityPhoto"));
  bucket.failDelete = true;
  const first = await workflow.cleanupAbandonedDrafts(db, bucket);
  assert.ok(first.expired >= 1);
  assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().status, "expired");
  assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().cleanupPending, true);
  assert.ok((await db.doc(`applications/${draft.applicationId}`).get()).data().finalCleanupAfter.toMillis() > Date.now());
  bucket.failDelete = false;
  await db.doc(`applications/${draft.applicationId}`).update({ finalCleanupAfter: new Date(Date.now() - 1000) });
  const second = await workflow.cleanupAbandonedDrafts(db, bucket);
  assert.ok(second.cleaned >= 1);
  assert.equal(bucket.objects.size, 0);
  assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().cleanupPending, false);
});

test("the grace-period sweep removes an upload that arrived after immediate cancellation", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const draft = await workflow.startDraft(db, bucket, user, "cook", {});
  await workflow.cancelDraft(db, bucket, user, draft.applicationId);
  const latePath = workflow.objectPath(user.uid, draft.applicationId, "cook", "identityDocument");
  bucket.objects.add(latePath);
  await db.doc(`applications/${draft.applicationId}`).update({ finalCleanupAfter: new Date(Date.now() - 1000) });
  await workflow.cleanupAbandonedDrafts(db, bucket);
  assert.equal(bucket.objects.has(latePath), false);
  assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().cleanupPending, false);
});

test("draft cleanup refuses unexpected paths without unbounded listing or deletion", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const draft = await workflow.startDraft(db, bucket, user, "rider", {});
  const getFiles = bucket.getFiles.bind(bucket);
  bucket.getFiles = async (options) => {
    assert.equal(options.maxResults, 3);
    assert.equal(options.autoPaginate, false);
    return getFiles(options);
  };
  const valid = workflow.objectPath(user.uid, draft.applicationId, "rider", "identityPhoto");
  const unexpected = `applications/${user.uid}/${draft.applicationId}/rider/unexpected`;
  bucket.objects.add(valid);
  bucket.objects.add(unexpected);
  await assert.rejects(workflow.cancelDraft(db, bucket, user, draft.applicationId), /Unexpected private file/);
  assert.equal(bucket.objects.has(valid), true);
  assert.equal(bucket.objects.has(unexpected), true);
  assert.equal((await db.doc(`applications/${draft.applicationId}`).get()).data().cleanupPending, true);
});

test("cleanup does not starve overdue files behind a full page of grace-period drafts", async () => {
  const batch = db.batch();
  for (let index = 0; index < 100; index += 1) {
    batch.set(db.doc(`applications/00Grace${String(index).padStart(4, "0")}`), {
      userId: `grace-user-${index}`, type: "cook", status: "cancelled", cleanupPending: true,
      finalCleanupAfter: new Date(Date.now() + 60 * 60 * 1000)
    });
  }
  const overdueId = "zzOverdueDraft123";
  const overdueUser = "overdue-user";
  batch.set(db.doc(`applications/${overdueId}`), {
    userId: overdueUser, type: "cook", status: "cancelled", cleanupPending: true,
    finalCleanupAfter: new Date(Date.now() - 1000)
  });
  await batch.commit();
  const bucket = fakeBucket();
  const path = workflow.objectPath(overdueUser, overdueId, "cook", "identityDocument");
  bucket.objects.add(path);
  await workflow.cleanupAbandonedDrafts(db, bucket);
  assert.equal(bucket.objects.has(path), false, "An overdue private file must not be starved by newer grace-period records");
});

test("a malformed expired draft is deferred without blocking a later valid draft", async () => {
  const brokenId = `BrokenDraft${process.pid}${sequence}`;
  await db.doc(`applications/${brokenId}`).set({
    status: "draft", type: "cook",
    expiryNextAttemptAt: new Date(Date.now() - 2000)
  });
  const user = caller();
  const valid = await workflow.startDraft(db, fakeBucket(), user, "rider", {}, Date.now() - 2 * 86400000);
  const outcome = await workflow.cleanupAbandonedDrafts(db, fakeBucket());
  assert.ok(outcome.expired >= 1);
  assert.equal((await db.doc(`applications/${valid.applicationId}`).get()).data().status, "expired");
  const broken = (await db.doc(`applications/${brokenId}`).get()).data();
  assert.equal(broken.status, "draft");
  assert.ok(broken.expiryNextAttemptAt.toMillis() > Date.now());
});

test("a full poisoned page cannot starve a later due draft in the same sweep", async () => {
  const nowMs = Date.now();
  const batch = db.batch();
  for (let index = 0; index < 100; index += 1) {
    batch.set(db.doc(`applications/PoisonPage${process.pid}${String(index).padStart(3, "0")}`), {
      status: "draft", type: "cook",
      expiryNextAttemptAt: new Date(nowMs - 2000)
    });
  }
  await batch.commit();
  const user = caller();
  const valid = await workflow.startDraft(db, fakeBucket(), user, "rider", {}, nowMs - 2 * 86400000);
  await db.doc(`applications/${valid.applicationId}`).update({ expiryNextAttemptAt: new Date(nowMs - 1000) });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await workflow.cleanupAbandonedDrafts(db, fakeBucket(), nowMs);
    assert.ok(result.expired >= 1);
  } finally {
    console.error = originalError;
  }
  assert.equal((await db.doc(`applications/${valid.applicationId}`).get()).data().status, "expired");
});

test("a declined application may be submitted again, but paths cannot be invented", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const draft = await workflow.startDraft(db, bucket, user, "cook", {});
  await workflow.submitDraft(db, user, draft.applicationId, async () => [], "REF-5");
  await db.doc(`applications/${draft.applicationId}`).update({ status: "approved" });
  await workflow.slotRef(db, user.uid, "cook").update({ status: "approved" });
  await assert.rejects(workflow.startDraft(db, bucket, user, "cook", {}), /already pending or approved/);
  await db.doc(`applications/${draft.applicationId}`).update({ status: "declined" });
  await workflow.slotRef(db, user.uid, "cook").update({ status: "declined" });
  const retry = await workflow.startDraft(db, bucket, user, "cook", {});
  assert.notEqual(retry.applicationId, draft.applicationId);
  assert.throws(() => workflow.objectPath(user.uid, retry.applicationId, "cook", "vehiclePhoto"));
  assert.throws(() => workflow.objectPath(user.uid, "../wrong", "cook", "foodPhoto"));
});

test("only a verified admin can preview an exact submitted document; access is audited", async () => {
  const user = caller();
  const bucket = fakeBucket();
  const draft = await workflow.startDraft(db, bucket, user, "rider", {});
  const path = workflow.objectPath(user.uid, draft.applicationId, "rider", "identityPhoto");
  const documents = [
    { field: "identityPhoto", path, generation: "7" },
    { field: "vehiclePhoto", path: workflow.objectPath(user.uid, draft.applicationId, "rider", "vehiclePhoto"), generation: "8" }
  ];
  await workflow.submitDraft(db, user, draft.applicationId, async () => documents, "REF-PREVIEW");
  const bytes = Buffer.from([1, 2, 3, 4]);
  let reads = 0;
  let unsafeMetadata = {};
  bucket.file = (requestedPath, options) => {
    assert.equal(requestedPath, path);
    assert.equal(String(options?.generation), "7");
    reads += 1;
    return {
      async getMetadata() { return [{ generation: "7", contentType: "image/png", size: bytes.length,
        metadata: { ownerId: user.uid, applicationId: draft.applicationId, field: "identityPhoto",
          sha256: createHash("sha256").update(bytes).digest("hex") }, ...unsafeMetadata }]; },
      async download() { return [bytes]; }
    };
  };
  const admin = { uid: "review-admin", token: { admin: true, email_verified: true } };
  for (const unauthorized of [
    null,
    { uid: "reviewer", token: { reviewer: true, email_verified: true } },
    { uid: "reviewer", token: { admin: false, email_verified: true } },
    { uid: "reviewer", token: { admin: true, email_verified: false } }
  ]) {
    await assert.rejects(workflow.readApplicationDocument(db, bucket, unauthorized, draft.applicationId, "identityPhoto"), /Authorized admin/);
  }
  assert.equal(reads, 0);
  await assert.rejects(workflow.readApplicationDocument(db, bucket, admin, draft.applicationId, "other"), /Invalid document field/);
  await db.doc(`applications/${draft.applicationId}`).update({ documents: [{ ...documents[0], path: "applications/other/bad" }] });
  await assert.rejects(workflow.readApplicationDocument(db, bucket, admin, draft.applicationId, "identityPhoto"), /not found/);
  await db.doc(`applications/${draft.applicationId}`).update({ documents });
  unsafeMetadata = { metadata: { ownerId: "other-user", applicationId: draft.applicationId,
    field: "identityPhoto", sha256: createHash("sha256").update(bytes).digest("hex") } };
  await assert.rejects(workflow.readApplicationDocument(db, bucket, admin, draft.applicationId, "identityPhoto"), /integrity check failed/);
  unsafeMetadata = { downloadTokens: "unsafe-token" };
  await assert.rejects(workflow.readApplicationDocument(db, bucket, admin, draft.applicationId, "identityPhoto"), /integrity check failed/);
  unsafeMetadata = {};
  const response = await workflow.readApplicationDocument(db, bucket, admin, draft.applicationId, "identityPhoto");
  assert.equal(response.base64, bytes.toString("base64"));
  assert.equal(response.contentType, "image/png");
  assert.equal(reads, 3);
  const audit = await db.collection("applicationDocumentAccess").where("applicationId", "==", draft.applicationId).get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().reviewedBy, admin.uid);
});

test("the callable handler rejects an unclaimed reviewer before any document read", async () => {
  await assert.rejects(callableFunctions.getApplicationDocument.run({
    auth: { uid: "reviewer", token: { reviewer: true, email_verified: true } },
    data: { applicationId: "SomeApplication123", field: "identityDocument" }
  }), /admin access is required/);
  await assert.rejects(callableFunctions.getApplicationDocument.run({
    auth: { uid: "admin", token: { admin: true, email_verified: false } },
    data: { applicationId: "SomeApplication123", field: "identityDocument" }
  }), /Verify your admin email/);
  await assert.rejects(callableFunctions.reviewPartnerApplication.run({
    auth: { uid: "reviewer", token: { reviewer: true, email_verified: true } },
    data: { applicationId: "SomeApplication123", decision: "approved" }
  }), /admin access is required/);
  await assert.rejects(callableFunctions.bootstrapAdmin.run({
    auth: { uid: "reviewer", token: { email_verified: true } }, data: {}
  }), /not authorized to bootstrap/);
  await assert.rejects(callableFunctions.startPartnerApplication.run({
    auth: { uid: "unverified", token: { email_verified: false } },
    data: { type: "cook", fields: {} }
  }), /Verify your email/);
});

test("verified callers cannot start uploads or reserve reviews without an approved retention configuration", async () => {
  await getFirestore(getApp()).doc("adminSecurity/global").set({ enabled: true, bootstrapEnabled: false, blockedUids: [] });
  await assert.rejects(callableFunctions.startPartnerApplication.run({
    auth: { uid: "verified-applicant", token: { email_verified: true } },
    data: { type: "cook", fields: {} }
  }), /retention policy is not configured/);
  await assert.rejects(callableFunctions.uploadApplicationDocument.run({
    auth: { uid: "verified-applicant", token: { email_verified: true } }, data: {}
  }), /retention policy is not configured/);
  await assert.rejects(callableFunctions.reviewPartnerApplication.run({
    auth: { uid: "verified-admin", token: { admin: true, email_verified: true } },
    data: { applicationId: "SomeApplication123", decision: "approved" }
  }), /retention policy is not configured/);
});
