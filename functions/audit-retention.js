const { Timestamp } = require("firebase-admin/firestore");
const { processDuePages, recordFailure, archiveResolvedFailure } = require("./job-failures");
const { recordDeadlineMs } = require("./record-retention");

const dayMs = 86400000;
const accessDays = 180;
const revisitDays = 30;

async function purgeDocumentAccessEvent(db, ref, nowMs = Date.now()) {
  return db.runTransaction(async (tx) => {
    const event = await tx.get(ref);
    const data = event.data();
    if (!data || !data.auditNextAttemptAt?.toMillis
        || data.auditNextAttemptAt.toMillis() > nowMs) return false;
    if (!/^[A-Za-z0-9]{10,40}$/.test(String(data.applicationId || ""))
        || !data.viewedAt?.toMillis) throw new Error("Malformed document-access audit event.");
    const application = await tx.get(db.doc(`applications/${data.applicationId}`));
    const caseDeadline = application.exists ? recordDeadlineMs(application.data()) : 0;
    const accessDeadline = data.viewedAt.toMillis() + accessDays * dayMs;
    if (application.exists && caseDeadline === null) {
      tx.update(ref, { auditNextAttemptAt: Timestamp.fromMillis(nowMs + revisitDays * dayMs) });
      return false;
    }
    const due = Math.max(accessDeadline, caseDeadline);
    if (nowMs < due) {
      tx.update(ref, { auditNextAttemptAt: Timestamp.fromMillis(due) });
      return false;
    }
    archiveResolvedFailure(tx, db, data.applicationId, "audit-access", data.jobFailures?.["audit-access"], nowMs);
    tx.delete(ref);
    return true;
  });
}

async function purgeDueDocumentAccessEvents(db, nowMs = Date.now()) {
  const due = db.collection("applicationDocumentAccess")
    .where("auditNextAttemptAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("auditNextAttemptAt");
  let purged = 0;
  await processDuePages(due, async (snapshot) => {
    try {
      if (await purgeDocumentAccessEvent(db, snapshot.ref, nowMs)) purged += 1;
    } catch (error) {
      await recordFailure(db, snapshot.ref, "audit-access", "auditNextAttemptAt",
        (current) => !!current.auditNextAttemptAt, error);
    }
  });
  return { purged };
}

async function purgeDueClaimAuditEvents(db, nowMs = Date.now()) {
  const due = db.collection("claimAuditEvents")
    .where("auditNextAttemptAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("auditNextAttemptAt");
  let purged = 0;
  await processDuePages(due, async (snapshot) => {
    try {
      const didPurge = await db.runTransaction(async (tx) => {
        const current = await tx.get(snapshot.ref);
        const data = current.data();
        if (!data?.auditNextAttemptAt?.toMillis || data.auditNextAttemptAt.toMillis() > nowMs) return false;
        if (!data.caseClosedAt?.toMillis || nowMs < data.caseClosedAt.toMillis() + 180 * dayMs) {
          throw new Error("Claim audit has no confirmed closure or retention window.");
        }
        tx.delete(snapshot.ref);
        return true;
      });
      if (didPurge) purged += 1;
    } catch (error) {
      await recordFailure(db, snapshot.ref, "audit-claim", "auditNextAttemptAt",
        (current) => !!current.auditNextAttemptAt, error);
    }
  });
  return { purged };
}

async function purgeDueResolvedFailureEvents(db, nowMs = Date.now()) {
  const due = db.collection("applicationFailureHistory")
    .where("auditNextAttemptAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("auditNextAttemptAt");
  let purged = 0;
  await processDuePages(due, async (snapshot) => {
    try {
      const changed = await db.runTransaction(async (tx) => {
        const current = await tx.get(snapshot.ref);
        if (!current.data()?.auditNextAttemptAt?.toMillis
            || current.data().auditNextAttemptAt.toMillis() > nowMs) return false;
        tx.delete(snapshot.ref);
        return true;
      });
      if (changed) purged += 1;
    } catch (error) {
      await recordFailure(db, snapshot.ref, "audit-failure", "auditNextAttemptAt",
        (current) => !!current.auditNextAttemptAt, error);
    }
  });
  return { purged };
}

module.exports = { purgeDocumentAccessEvent, purgeDueDocumentAccessEvents,
  purgeDueClaimAuditEvents, purgeDueResolvedFailureEvents };
