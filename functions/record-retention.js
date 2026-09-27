const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { processDuePages, recordFailure, archiveResolvedFailure } = require("./job-failures");
const { slotRef } = require("./application-workflow");

const dayMs = 86400000;
const draftDays = 30;
const declinedDays = 180;
const offboardedDays = 180;

function recordDeadlineMs(application) {
  if (!application || application.appeal?.status === "open"
      || application.dispute?.status === "open" || application.legalHold?.status === "active"
      || application.reviewNeedsReconcile === true) return null;
  if (["cancelled", "expired"].includes(application.status)) {
    const cleaned = application.cleanupAt?.toMillis?.();
    return application.cleanupPending === false && Number.isFinite(cleaned)
      ? cleaned + draftDays * dayMs : null;
  }
  if (application.status === "declined") {
    const notice = application.noticeConfirmedAt?.toMillis?.();
    const purged = application.documentsPurgedAt?.toMillis?.();
    if (application.documentCleanupPending !== false || !Number.isFinite(notice)
        || !Number.isFinite(purged)) return null;
    const closure = Math.max(notice + 14 * dayMs,
      application.appeal?.closedAt?.toMillis?.() || 0,
      application.dispute?.closedAt?.toMillis?.() || 0,
      application.reviewedAt?.toMillis?.() || 0);
    return closure + declinedDays * dayMs;
  }
  if (application.status === "approved") {
    const offboarded = application.offboarding?.offboardedAt?.toMillis?.();
    const claimRevoked = application.offboarding?.claimRevokedAt?.toMillis?.();
    if (application.offboarding?.status !== "complete" || !Number.isFinite(offboarded)
        || !Number.isFinite(claimRevoked) || application.documentCleanupPending !== false
        || !application.documentsPurgedAt?.toMillis) return null;
    return offboarded + offboardedDays * dayMs;
  }
  return null;
}

function purgeSchedule(application) {
  const deadline = recordDeadlineMs(application);
  return { recordPurgeAt: deadline === null ? FieldValue.delete() : Timestamp.fromMillis(deadline) };
}

async function purgeApplicationRecord(db, applicationId, nowMs = Date.now()) {
  const ref = db.doc(`applications/${applicationId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const application = snap.data();
    const deadline = recordDeadlineMs(application);
    if (!application || !application.recordPurgeAt?.toMillis || deadline > nowMs) return false;
    if (deadline === null) {
      if (application.appeal?.status === "open" || application.dispute?.status === "open"
          || application.legalHold?.status === "active") {
        tx.update(ref, { recordPurgeAt: FieldValue.delete() });
        return false;
      }
      throw new Error("Record purge is no longer eligible; manual review required.");
    }
    if (application.recordPurgeAt.toMillis() < deadline) return false;
    const events = await tx.get(ref.collection("events").limit(100));
    const claimAudits = await tx.get(db.collection("claimAuditEvents")
      .where("applicationId", "==", applicationId).limit(100));
    if (events.size === 100 || claimAudits.size === 100) {
      throw new Error("Application audit exceeds bounded purge; manual review required.");
    }
    const receipt = db.doc(`applicationNoticeReceipts/${applicationId}`);
    const receiptSnap = await tx.get(receipt);
    const slot = slotRef(db, application.userId, application.type);
    const slotSnap = await tx.get(slot);
    archiveResolvedFailure(tx, db, applicationId, "record-purge", application.jobFailures?.["record-purge"], nowMs);
    for (const event of events.docs) tx.delete(event.ref);
    for (const event of claimAudits.docs) tx.delete(event.ref);
    if (receiptSnap.exists) tx.delete(receipt);
    if (slotSnap.data()?.applicationId === applicationId) tx.delete(slot);
    tx.delete(ref);
    return true;
  });
}

async function purgeDueApplicationRecords(db, nowMs = Date.now()) {
  const due = db.collection("applications").where("recordPurgeAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("recordPurgeAt");
  let purged = 0;
  await processDuePages(due, async (snapshot) => {
    try {
      if (await purgeApplicationRecord(db, snapshot.id, nowMs)) purged += 1;
    } catch (error) {
      await recordFailure(db, snapshot.ref, "record-purge", "recordPurgeAt",
        (current) => !!current.recordPurgeAt, error);
    }
  });
  return { purged };
}

module.exports = { recordDeadlineMs, purgeSchedule, purgeApplicationRecord, purgeDueApplicationRecords };
