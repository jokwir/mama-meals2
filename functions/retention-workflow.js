const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { objectPath, fieldsByType } = require("./application-workflow");
const { recordFailure, processDuePages, archiveResolvedFailure } = require("./job-failures");
const { acquireDeletionLease, releaseDeletionLease, deletionEligibility } = require("./application-protection");
const { purgeSchedule } = require("./record-retention");
const dayMs = 24 * 60 * 60 * 1000;
const fieldClasses = Object.freeze({
  identityDocument: "identity",
  identityPhoto: "identity",
  foodSafetyDocument: "foodSafety",
  foodPhoto: "foodPhoto",
  vehiclePhoto: "vehicle"
});
const classKeys = Object.freeze({
  identity: "IDENTITY", foodSafety: "FOOD_SAFETY", foodPhoto: "FOOD_PHOTO", vehicle: "VEHICLE"
});

function parseDays(environment, key) {
  if (environment[key] === undefined || environment[key] === "") return undefined;
  const value = String(environment[key]);
  const days = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isInteger(days) || days > 3650) {
    throw new Error(`${key} must be an integer from 1 to 3650 or left unset.`);
  }
  return days;
}

function configuredRecordMinimizationDays(environment = process.env) {
  return parseDays(environment, "APPLICATION_RECORD_MINIMIZE_DAYS_AFTER_PURGE");
}

function configuredRetentionDays(environment = process.env) {
  const result = {};
  for (const [status, key] of [
    ["approved", "APPLICATION_APPROVED_RETENTION_DAYS"],
    ["declined", "APPLICATION_DECLINED_RETENTION_DAYS"]
  ]) {
    const days = parseDays(environment, key);
    if (days !== undefined) result[status] = days;
    const overrides = {};
    for (const [fieldClass, suffix] of Object.entries(classKeys)) {
      const override = parseDays(environment, `APPLICATION_${status.toUpperCase()}_${suffix}_RETENTION_DAYS`);
      if (override !== undefined) overrides[fieldClass] = override;
    }
    if (Object.keys(overrides).length) {
      if (days === undefined && Object.keys(overrides).length !== Object.keys(classKeys).length) {
        throw new Error(`All ${status} document classes need retention days without a status fallback.`);
      }
      result.byField ||= {};
      result.byField[status] = overrides;
    }
  }
  return result;
}

function missingRetentionClasses(retentionDays) {
  return ["approved", "declined"].flatMap((status) =>
    Object.keys(classKeys)
      .filter((fieldClass) => retentionDays.byField?.[status]?.[fieldClass] === undefined
        && retentionDays[status] === undefined)
      .map((fieldClass) => `${status}.${fieldClass}`));
}

function scheduleDocuments(documents, status, retentionDays, nowMs = Date.now()) {
  const fallback = retentionDays[status];
  const overrides = retentionDays.byField?.[status] || {};
  const scheduled = documents.map((document) => {
    const fieldClass = fieldClasses[document.field];
    if (!fieldClass) throw new Error("Unknown application document class; refusing to schedule retention.");
    const days = overrides[fieldClass] ?? fallback;
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3650)) {
      throw new Error("Invalid application document retention period.");
    }
    return days === undefined ? document : {
      ...document, purgeAt: Timestamp.fromMillis(nowMs + days * dayMs)
    };
  });
  const deadlines = scheduled.map((document) => document.purgeAt?.toMillis()).filter(Number.isFinite);
  if (deadlines.length && deadlines.length !== scheduled.length) {
    throw new Error("Incomplete application document retention policy.");
  }
  const nextPurgeAt = deadlines.length
    ? Timestamp.fromMillis(Math.min(...deadlines))
    : fallback && !documents.length ? Timestamp.fromMillis(nowMs + fallback * dayMs) : null;
  return { documents: scheduled, nextPurgeAt };
}

async function purgeSubmittedFiles(db, bucket, applicationId, nowMs = Date.now(),
  minimizeDays = configuredRecordMinimizationDays()) {
  const ref = db.doc(`applications/${applicationId}`);
  const lease = await acquireDeletionLease(db, ref, nowMs);
  if (!lease) return false;
  const application = lease.application;
  try {
  const expected = fieldsByType[application.type];
  if (!expected || !application.userId) throw new Error("Application identity is incomplete; refusing deletion.");
  const documents = application.documents || [];
  const individual = documents.some((document) => document.purgeAt !== undefined);
  if (individual && documents.some((document) => !document.purgeAt?.toMillis)) {
    throw new Error("Incomplete document retention schedule; refusing deletion.");
  }
  const paths = documents.map((document) => {
    if (!expected.includes(document.field)) throw new Error("Unexpected application document field; refusing deletion.");
    const path = objectPath(application.userId, applicationId, application.type, document.field);
    if (document.path !== path || !/^\d+$/.test(String(document.generation || ""))) {
      throw new Error("Application document path or generation mismatch; refusing deletion.");
    }
    return { path, generation: document.generation };
  });
  if (new Set(paths.map((entry) => entry.path)).size !== paths.length) {
    throw new Error("Duplicate application document field; refusing deletion.");
  }
  const due = documents.map((document, index) => ({ document, ...paths[index] }))
    .filter(({ document }) => !individual || document.purgeAt.toMillis() <= nowMs);
  for (const { path, generation } of due) {
    await bucket.file(path, { generation }).delete({ ignoreNotFound: true });
  }
  const remaining = individual
    ? documents.filter((document) => document.purgeAt.toMillis() > nowMs) : [];
  return await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (current.data()?.documentDeletionLease?.token !== lease.token
        || !deletionEligibility(current.data(), nowMs).allowed
        || current.data()?.documentCleanupPending !== true
        || current.data()?.userId !== application.userId
        || current.data()?.status !== application.status
        || JSON.stringify(current.data()?.documents) !== JSON.stringify(documents)) return false;
    const deletedClasses = { ...(current.data()?.documentClassDeletedAt || {}) };
    for (const { document } of due) deletedClasses[fieldClasses[document.field]] = Timestamp.fromMillis(nowMs);
    if (remaining.length) {
      const next = Timestamp.fromMillis(Math.min(...remaining.map((document) => document.purgeAt.toMillis())));
      archiveResolvedFailure(transaction, db, applicationId, "retention", current.data().jobFailures?.retention, nowMs);
      transaction.update(ref, {
        documents: remaining, documentsPurgeAt: next, documentNextAttemptAt: next,
        documentClassDeletedAt: deletedClasses, documentDeletionLease: FieldValue.delete(),
        "jobFailures.retention": FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
    } else {
      archiveResolvedFailure(transaction, db, applicationId, "retention", current.data().jobFailures?.retention, nowMs);
      transaction.update(ref, {
        fields: FieldValue.delete(), documents: FieldValue.delete(), uploadAttempts: FieldValue.delete(),
        expiresAt: FieldValue.delete(), expiryNextAttemptAt: FieldValue.delete(),
        finalCleanupAfter: FieldValue.delete(), cleanupAt: FieldValue.delete(),
        documentDeletionLease: FieldValue.delete(), documentClassDeletedAt: deletedClasses,
        documentCleanupPending: false,
        documentsPurgeAt: FieldValue.delete(),
        documentNextAttemptAt: FieldValue.delete(),
        documentsPurgedAt: Timestamp.fromMillis(nowMs),
        recordMinimizePending: false, recordMinimizeAt: FieldValue.delete(),
        recordMinimizedAt: Timestamp.fromMillis(nowMs),
        ...purgeSchedule({ ...current.data(), documentCleanupPending: false,
          documentsPurgedAt: Timestamp.fromMillis(nowMs) }),
        "jobFailures.retention": FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    return true;
  });
  } finally {
    await releaseDeletionLease(db, ref, lease.token);
  }
}

async function cleanupSubmittedDocuments(db, bucket, nowMs = Date.now()) {
  const due = db.collection("applications")
    .where("documentCleanupPending", "==", true)
    .where("documentNextAttemptAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("documentNextAttemptAt");
  let purged = 0;
  await processDuePages(due, async (snapshot) => {
    try {
      if (await purgeSubmittedFiles(db, bucket, snapshot.id, nowMs)) purged += 1;
    } catch (error) {
      await recordFailure(db, snapshot.ref, "retention", "documentNextAttemptAt",
        (current) => current.documentCleanupPending === true, error);
    }
  });
  return { purged };
}

async function minimizeApplicationRecord(db, applicationId, nowMs = Date.now()) {
  const ref = db.doc(`applications/${applicationId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const application = snapshot.data();
    if (!application || application.recordMinimizePending !== true
        || !application.recordMinimizeAt?.toMillis
        || application.recordMinimizeAt.toMillis() > nowMs) return false;
    if (!["approved", "declined"].includes(application.status)
        || application.documentCleanupPending !== false
        || !application.documentsPurgedAt?.toMillis
        || application.documents?.length) {
      throw new Error("Application documents are not fully purged; refusing record minimization.");
    }
    if (!deletionEligibility({ ...application, documentCleanupPending: true }, nowMs).allowed) return false;
    archiveResolvedFailure(transaction, db, applicationId, "minimization", application.jobFailures?.minimization, nowMs);
    transaction.update(ref, {
      fields: FieldValue.delete(), documents: FieldValue.delete(),
      uploadAttempts: FieldValue.delete(),
      expiresAt: FieldValue.delete(), expiryNextAttemptAt: FieldValue.delete(),
      finalCleanupAfter: FieldValue.delete(), cleanupAt: FieldValue.delete(),
      recordMinimizePending: false, recordMinimizeAt: FieldValue.delete(),
      recordMinimizedAt: Timestamp.fromMillis(nowMs),
      "jobFailures.minimization": FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return true;
  });
}

async function minimizeApplicationRecords(db, nowMs = Date.now()) {
  if (configuredRecordMinimizationDays() === undefined) return { minimized: 0, disabled: true };
  const due = db.collection("applications")
    .where("recordMinimizePending", "==", true)
    .where("recordMinimizeAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("recordMinimizeAt");
  let minimized = 0;
  await processDuePages(due, async (snapshot) => {
    try {
      if (await minimizeApplicationRecord(db, snapshot.id, nowMs)) minimized += 1;
    } catch (error) {
      await recordFailure(db, snapshot.ref, "minimization", "recordMinimizeAt",
        (current) => current.recordMinimizePending === true, error);
    }
  });
  return { minimized };
}

module.exports = {
  configuredRetentionDays, configuredRecordMinimizationDays, missingRetentionClasses, scheduleDocuments,
  purgeSubmittedFiles, cleanupSubmittedDocuments, minimizeApplicationRecord, minimizeApplicationRecords
};
