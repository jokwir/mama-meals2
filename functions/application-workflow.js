const crypto = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { runtimeConfig } = require("./runtime-config");
const { recordFailure, processDuePages, archiveResolvedFailure } = require("./job-failures");

const draftLifetimeMs = 24 * 60 * 60 * 1000;
const cleanupGraceMs = 60 * 60 * 1000;
const fieldsByType = Object.freeze({
  cook: ["identityDocument", "foodSafetyDocument", "foodPhoto"],
  rider: ["identityPhoto", "vehiclePhoto"]
});

function slotRef(db, uid, type) {
  const key = crypto.createHash("sha256").update(`${uid}:${type}`).digest("hex");
  return db.doc(`applicationSlots/${key}`);
}

function usageRef(db, uid) {
  return db.doc(`applicationUsage/${crypto.createHash("sha256").update(uid).digest("hex")}`);
}

function usageDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function objectPath(uid, applicationId, type, field) {
  if (!/^[A-Za-z0-9]{10,40}$/.test(applicationId)
      || !fieldsByType[type]?.includes(field)
      || !uid || uid.includes("/")) {
    throw new HttpsError("invalid-argument", "Invalid application document path.");
  }
  return `applications/${uid}/${applicationId}/${type}/${field}`;
}

function requireDraft(application, uid, nowMs) {
  if (!application || application.userId !== uid) {
    throw new HttpsError("permission-denied", "This application does not belong to your account.");
  }
  if (application.status !== "draft" || !application.expiresAt?.toMillis
      || application.expiresAt.toMillis() <= nowMs) {
    throw new HttpsError("failed-precondition", "This draft is no longer open. Start a new application.");
  }
}

async function cleanApplicationFiles(db, bucket, applicationId, application) {
  const ref = db.doc(`applications/${applicationId}`);
  const snapshot = await ref.get();
  const current = snapshot.data();
  if (!current || current.userId !== application.userId
      || !["cancelled", "expired"].includes(current.status)) return false;
  const expectedPaths = fieldsByType[current.type]?.map((field) =>
    objectPath(current.userId, applicationId, current.type, field));
  if (!expectedPaths?.length) throw new Error("Invalid application file manifest; refusing cleanup.");
  const prefix = `applications/${current.userId}/${applicationId}/`;
  const [files] = await bucket.getFiles({ prefix, maxResults: expectedPaths.length + 1, autoPaginate: false });
  if (files.length > expectedPaths.length || files.some((file) => !expectedPaths.includes(file.name))) {
    throw new Error("Unexpected private file path or count; refusing cleanup.");
  }
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  return db.runTransaction(async (transaction) => {
    const latest = await transaction.get(ref);
    if (latest.exists && latest.data().userId === current.userId
        && ["cancelled", "expired"].includes(latest.data().status)
        && latest.data().finalCleanupAfter?.toMillis() <= Date.now()) {
      const cleanedAt = Date.now();
      archiveResolvedFailure(transaction, db, applicationId, "cleanup", latest.data().jobFailures?.cleanup, cleanedAt);
      transaction.update(ref, { cleanupPending: false, cleanupAt: Timestamp.fromMillis(cleanedAt),
        fields: FieldValue.delete(), uploadAttempts: FieldValue.delete(),
        finalCleanupAfter: FieldValue.delete(),
        recordPurgeAt: Timestamp.fromMillis(cleanedAt + 30 * draftLifetimeMs),
        "jobFailures.cleanup": FieldValue.delete() });
      return true;
    }
    return false;
  });
}

async function startDraft(db, bucket, caller, type, fields, nowMs = Date.now()) {
  if (!fieldsByType[type]) throw new HttpsError("invalid-argument", "Application type must be cook or rider.");
  const config = runtimeConfig();
  const usage = usageRef(db, caller.uid);
  const day = usageDay(nowMs);
  const usageSnapshot = await usage.get();
  if (usageSnapshot.data()?.day === day && usageSnapshot.data()?.drafts >= config.draftsPerDay) {
    throw new HttpsError("resource-exhausted", "Too many application attempts today. Try again later.");
  }
  const previous = await db.collection("applications").where("userId", "==", caller.uid).limit(100).get();
  if (previous.size >= 100) throw new HttpsError("resource-exhausted", "Too many applications. Contact support.");
  if (previous.docs.some((item) => item.data().type === type
      && (["pending", "reviewing", "approved"].includes(item.data().status)
        || item.data().appeal?.status === "open"))) {
    throw new HttpsError("already-exists", `A ${type} application is already pending or approved.`);
  }
  const ref = db.collection("applications").doc();
  const slot = slotRef(db, caller.uid, type);
  const replaced = await db.runTransaction(async (transaction) => {
    const [slotSnapshot, rateSnapshot] = await Promise.all([transaction.get(slot), transaction.get(usage)]);
    const rate = rateSnapshot.data()?.day === day ? rateSnapshot.data() : { drafts: 0, uploads: 0 };
    if (rate.drafts >= config.draftsPerDay) {
      throw new HttpsError("resource-exhausted", "Too many application attempts today. Try again later.");
    }
    const current = slotSnapshot.data();
    if (current?.appealOpenApplicationId) {
      throw new HttpsError("failed-precondition", "Resolve your open appeal before applying again for this role.");
    }
    let oldToClean = null;
    if (["pending", "reviewing", "approved"].includes(current?.status)) {
      throw new HttpsError("already-exists", `A ${type} application is already pending or approved.`);
    }
    if (current?.status === "draft" && current.applicationId) {
      const oldRef = db.doc(`applications/${current.applicationId}`);
      const oldSnapshot = await transaction.get(oldRef);
      if (oldSnapshot.exists && oldSnapshot.data().status === "draft") {
        oldToClean = { id: current.applicationId, data: oldSnapshot.data() };
        transaction.update(oldRef, {
          status: "cancelled", cleanupPending: true,
          finalCleanupAfter: Timestamp.fromMillis(Date.now() + cleanupGraceMs),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
    }
    transaction.create(ref, {
      userId: caller.uid,
      type,
      status: "draft",
      fields,
      expiresAt: Timestamp.fromMillis(nowMs + draftLifetimeMs),
      expiryNextAttemptAt: Timestamp.fromMillis(nowMs + draftLifetimeMs),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.set(slot, {
      userId: caller.uid, type, applicationId: ref.id, status: "draft",
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.set(usage, { day, drafts: rate.drafts + 1, uploads: rate.uploads || 0,
      updatedAt: FieldValue.serverTimestamp() });
    return oldToClean;
  });
  if (replaced) {
    await cleanApplicationFiles(db, bucket, replaced.id, replaced.data).catch((error) => {
      console.error("Replaced draft cleanup deferred", { applicationId: replaced.id,
        code: String(error.code || "unknown").slice(0, 50) });
    });
  }
  return { applicationId: ref.id, type, status: "draft" };
}

async function submitDraft(db, caller, applicationId, verifyDocuments, reference, nowMs = Date.now()) {
  const ref = db.doc(`applications/${applicationId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Application draft not found.");
  const application = snapshot.data();
  if (application.userId !== caller.uid) {
    throw new HttpsError("permission-denied", "This application does not belong to your account.");
  }
  if (application.status === "pending") {
    return { applicationId, type: application.type, reference: application.reference, status: "pending", emailStatus: "not-configured" };
  }
  requireDraft(application, caller.uid, nowMs);
  const documents = await verifyDocuments(application.userId, applicationId, application.type);
  const slot = slotRef(db, caller.uid, application.type);
  const outcome = await db.runTransaction(async (transaction) => {
    const [current, slotSnapshot] = await Promise.all([transaction.get(ref), transaction.get(slot)]);
    if (current.data()?.userId === caller.uid && current.data()?.status === "pending"
        && slotSnapshot.data()?.applicationId === applicationId) {
      return current.data().reference;
    }
    requireDraft(current.data(), caller.uid, Date.now());
    if (slotSnapshot.data()?.appealOpenApplicationId) {
      throw new HttpsError("failed-precondition", "Resolve your open appeal before submitting another application for this role.");
    }
    if (slotSnapshot.data()?.applicationId !== applicationId || slotSnapshot.data()?.status !== "draft") {
      throw new HttpsError("failed-precondition", "This draft has been replaced or submitted.");
    }
    transaction.update(ref, {
      status: "pending", reference, documents,
      pendingReviewAlertAt: Timestamp.fromMillis(nowMs + runtimeConfig().pendingReviewAlertDays * draftLifetimeMs),
      submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
    transaction.update(slot, { status: "pending", updatedAt: FieldValue.serverTimestamp() });
    return reference;
  });
  return { applicationId, type: application.type, reference: outcome, status: "pending", submittedAt: new Date().toISOString(), emailStatus: "not-configured" };
}

async function flagPendingApplications(db, nowMs = Date.now()) {
  const due = db.collection("applications")
    .where("status", "==", "pending")
    .where("pendingReviewAlertAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("pendingReviewAlertAt");
  let flagged = 0;
  await processDuePages(due, async (snapshot) => {
    const changed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(snapshot.ref);
      if (current.data()?.status !== "pending" || !current.data()?.pendingReviewAlertAt?.toMillis
          || current.data().pendingReviewAlertAt.toMillis() > nowMs) return false;
      transaction.update(snapshot.ref, {
        pendingReviewFlaggedAt: Timestamp.fromMillis(nowMs), pendingReviewAlertAt: FieldValue.delete()
      });
      return true;
    });
    if (changed) {
      flagged += 1;
      console.warn("Pending application needs human review", { applicationId: snapshot.id });
    }
  });
  return { flagged };
}

async function cancelDraft(db, bucket, caller, applicationId) {
  const ref = db.doc(`applications/${applicationId}`);
  let application;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data().userId !== caller.uid) {
      throw new HttpsError("permission-denied", "This application does not belong to your account.");
    }
    application = snapshot.data();
    if (application.status === "pending") return;
    if (!new Set(["draft", "cancelled", "expired"]).has(application.status)) {
      throw new HttpsError("failed-precondition", "This application can no longer be cancelled.");
    }
    if (application.status !== "draft") return;
    const slot = slotRef(db, caller.uid, application.type);
    const slotSnapshot = await transaction.get(slot);
    transaction.update(ref, {
      status: "cancelled", cleanupPending: true,
      finalCleanupAfter: Timestamp.fromMillis(Date.now() + cleanupGraceMs),
      updatedAt: FieldValue.serverTimestamp()
    });
    if (slotSnapshot.data()?.applicationId === applicationId && slotSnapshot.data()?.status === "draft") {
      transaction.update(slot, { status: "cancelled", updatedAt: FieldValue.serverTimestamp() });
    }
  });
  if (application.status === "pending") {
    return { status: "pending", reference: application.reference, type: application.type, applicationId };
  }
  await cleanApplicationFiles(db, bucket, applicationId, application);
  return { status: "cancelled", applicationId };
}

async function cleanupAbandonedDrafts(db, bucket, nowMs = Date.now()) {
  const expired = db.collection("applications")
    .where("status", "==", "draft")
    .where("expiryNextAttemptAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("expiryNextAttemptAt");
  let expiredCount = 0;
  await processDuePages(expired, async (snapshot) => {
    try {
      const didExpire = await db.runTransaction(async (transaction) => {
        const current = await transaction.get(snapshot.ref);
        if (!current.exists || current.data().status !== "draft" || current.data().expiresAt.toMillis() > Date.now()) return false;
        const application = current.data();
        objectPath(application.userId, snapshot.id, application.type, fieldsByType[application.type]?.[0]);
        const slot = slotRef(db, application.userId, application.type);
        const slotSnapshot = await transaction.get(slot);
        archiveResolvedFailure(transaction, db, snapshot.id, "expiry", application.jobFailures?.expiry, nowMs);
        transaction.update(snapshot.ref, {
          status: "expired", cleanupPending: true,
          "jobFailures.expiry": FieldValue.delete(),
          expiryNextAttemptAt: FieldValue.delete(),
          finalCleanupAfter: Timestamp.fromMillis(Date.now() + cleanupGraceMs),
          updatedAt: FieldValue.serverTimestamp()
        });
        if (slotSnapshot.data()?.applicationId === snapshot.id && slotSnapshot.data()?.status === "draft") {
          transaction.update(slot, { status: "expired", updatedAt: FieldValue.serverTimestamp() });
        }
        return true;
      });
      if (didExpire) expiredCount += 1;
    } catch (error) {
      await recordFailure(db, snapshot.ref, "expiry", "expiryNextAttemptAt",
        (current) => current.status === "draft", error);
    }
  });
  const pending = db.collection("applications")
    .where("cleanupPending", "==", true)
    .where("finalCleanupAfter", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("finalCleanupAfter");
  let cleaned = 0;
  await processDuePages(pending, async (snapshot) => {
    try {
      if (await cleanApplicationFiles(db, bucket, snapshot.id, snapshot.data())) cleaned += 1;
    } catch (error) {
      await recordFailure(db, snapshot.ref, "cleanup", "finalCleanupAfter",
        (current) => current.cleanupPending === true && ["cancelled", "expired"].includes(current.status), error);
    }
  });
  return { expired: expiredCount, cleaned };
}

async function readApplicationDocument(db, bucket, caller, applicationId, field) {
  if (!caller?.uid || caller.token?.admin !== true || caller.token?.email_verified !== true) {
    throw new HttpsError("permission-denied", "Authorized admin review is required.");
  }
  if (!/^[A-Za-z0-9]{10,40}$/.test(String(applicationId || ""))) {
    throw new HttpsError("invalid-argument", "Invalid application identifier.");
  }
  const snapshot = await db.doc(`applications/${applicationId}`).get();
  if (!snapshot.exists || !["pending", "reviewing", "approved", "declined"].includes(snapshot.data().status)) {
    throw new HttpsError("not-found", "Submitted application not found.");
  }
  const application = snapshot.data();
  if (!fieldsByType[application.type]?.includes(field)) {
    throw new HttpsError("invalid-argument", "Invalid document field.");
  }
  const document = application.documents?.find((item) => item.field === field);
  const path = objectPath(application.userId, applicationId, application.type, field);
  if (!document || document.path !== path || !/^\d+$/.test(String(document.generation || ""))) {
    throw new HttpsError("not-found", "Application document not found.");
  }
  const file = bucket.file(path, { generation: document.generation });
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (String(metadata.generation || "") !== String(document.generation || "")
      || !new Set(["image/jpeg", "image/png", "image/webp"]).has(metadata.contentType)
      || size <= 0 || size > 2 * 1024 * 1024
      || metadata.downloadTokens || metadata.metadata?.firebaseStorageDownloadTokens
      || metadata.metadata?.ownerId !== application.userId
      || metadata.metadata?.applicationId !== applicationId
      || metadata.metadata?.field !== field) {
    throw new HttpsError("failed-precondition", "Document integrity check failed.");
  }
  const [buffer] = await file.download();
  if (buffer.length !== size
      || metadata.metadata?.sha256 !== crypto.createHash("sha256").update(buffer).digest("hex")) {
    throw new HttpsError("failed-precondition", "Document integrity check failed.");
  }
  await db.collection("applicationDocumentAccess").add({
    applicationId, field, reviewedBy: caller.uid, viewedAt: FieldValue.serverTimestamp(),
    auditNextAttemptAt: Timestamp.fromMillis(Date.now() + 180 * 24 * 60 * 60 * 1000)
  });
  return { contentType: metadata.contentType, base64: buffer.toString("base64") };
}

module.exports = {
  fieldsByType, objectPath, requireDraft, slotRef, usageRef, startDraft, submitDraft, cancelDraft,
  cleanupAbandonedDrafts, flagPendingApplications, readApplicationDocument
};
