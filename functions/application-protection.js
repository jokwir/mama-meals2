const crypto = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { slotRef } = require("./application-workflow");
const { purgeSchedule } = require("./record-retention");

const dayMs = 86400000;
const appealWindowMs = 14 * dayMs;
const appealResponseMs = 7 * dayMs;
const deletionLeaseMs = 10 * 60 * 1000;
const maxHistory = 20;
const terminal = new Set(["approved", "declined"]);
const validId = /^[A-Za-z0-9]{10,40}$/;
const validCode = /^[a-z][a-z0-9-]{1,49}$/;
const appealOutcomes = new Set(["upheld", "withdrawn"]);

function requireAdmin(caller) {
  if (!caller?.uid || caller.token?.admin !== true || caller.token?.email_verified !== true) {
    throw new HttpsError("permission-denied", "Verified admin access is required.");
  }
}

function applicationRef(db, id) {
  if (!validId.test(String(id || ""))) throw new HttpsError("invalid-argument", "Invalid application identifier.");
  return db.doc(`applications/${id}`);
}

function eventCode(value) {
  if (!validCode.test(String(value || ""))) throw new HttpsError("invalid-argument", "A coded reason is required.");
  return value;
}

function noDeletionLease(application, nowMs) {
  if (application.documentDeletionLease?.until?.toMillis() > nowMs
      || application.recordDeletionLease?.until?.toMillis() > nowMs) {
    throw new HttpsError("unavailable", "Document deletion is in progress. Retry shortly.");
  }
}

function appendHistory(existing, entry) {
  const history = existing || [];
  if (!Array.isArray(history) || history.length >= maxHistory) {
    throw new HttpsError("resource-exhausted", "Application history requires manual review.");
  }
  return [...history, entry];
}

function nextAttempt(application, nowMs) {
  if (application.documentCleanupPending !== true) return {};
  const due = application.documentsPurgeAt?.toMillis();
  return { documentNextAttemptAt: Timestamp.fromMillis(Math.max(nowMs, Number.isFinite(due) ? due : nowMs)) };
}

function deletionEligibility(application, nowMs) {
  if (!terminal.has(application.status) || application.documentCleanupPending !== true) return { allowed: false, reason: "not-terminal" };
  const notice = application.noticeConfirmedAt?.toMillis?.();
  if (!Number.isFinite(notice)) return { allowed: false, reason: "notice-unconfirmed" };
  if (application.appeal?.status === "open") return { allowed: false, reason: "appeal-open" };
  if (application.dispute?.status === "open") return { allowed: false, reason: "dispute-open" };
  if (application.legalHold?.status === "active") return { allowed: false, reason: "legal-hold" };
  const floor = Math.max(application.status === "declined" ? notice + appealWindowMs : 0,
    application.protectionReleasedAt?.toMillis?.() || 0);
  if (nowMs < floor) return { allowed: false, reason: "window-open", nextAt: floor };
  return { allowed: true };
}

async function confirmNotice(db, caller, id, methodCode, nowMs = Date.now()) {
  requireAdmin(caller);
  if (methodCode !== "verified-email") {
    throw new HttpsError("invalid-argument", "Only confirmed verified-email notice is supported.");
  }
  const ref = applicationRef(db, id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || !terminal.has(data.status)) throw new HttpsError("failed-precondition", "A completed decision is required.");
    noDeletionLease(data, nowMs);
    if (data.noticeConfirmedAt) return { confirmed: true, alreadyConfirmed: true };
    const receipt = await tx.get(db.doc(`applicationNoticeReceipts/${id}`));
    const proof = receipt.data();
    if (!proof || proof.recipientUid !== data.userId || proof.revision !== (data.noticeRevision || 1)
        || proof.channelCode !== "verified-email" || proof.deliveryEvidenceCode !== "provider-confirmed"
        || !proof.sendAttemptAt?.toMillis || !proof.confirmedAt?.toMillis
        || proof.sendAttemptAt.toMillis() < (data.reviewedAt?.toMillis?.() || 0)
        || proof.confirmedAt.toMillis() < proof.sendAttemptAt.toMillis()
        || proof.confirmedAt.toMillis() > nowMs) {
      throw new HttpsError("failed-precondition", "Verified-email delivery confirmation is unavailable.");
    }
    tx.update(ref, {
      noticeConfirmedAt: proof.confirmedAt, noticeConfirmedBy: caller.uid,
      noticeMethodCode: methodCode, noticeConfirmationPending: false,
      documentRetentionBlockedReason: FieldValue.delete(),
      ...nextAttempt(data, nowMs), updatedAt: FieldValue.serverTimestamp()
    });
    return { confirmed: true, alreadyConfirmed: false };
  });
}

async function requestAppeal(db, caller, id, nowMs = Date.now()) {
  if (!caller?.uid || caller.token?.email_verified !== true) throw new HttpsError("permission-denied", "Verified account access is required.");
  const ref = applicationRef(db, id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.userId !== caller.uid) throw new HttpsError("permission-denied", "Application access denied.");
    if (data.status !== "declined") throw new HttpsError("failed-precondition", "Only a declined decision can be appealed.");
    noDeletionLease(data, nowMs);
    const notice = data.noticeConfirmedAt?.toMillis?.();
    if (!Number.isFinite(notice)) throw new HttpsError("failed-precondition", "Decision notice is not confirmed yet.");
    if (data.appeal?.status === "closed") throw new HttpsError("failed-precondition", "This appeal has already been resolved.");
    const slot = slotRef(db, data.userId, data.type);
    const slotSnapshot = await tx.get(slot);
    if (slotSnapshot.data()?.appealOpenApplicationId && slotSnapshot.data().appealOpenApplicationId !== id) {
      throw new HttpsError("failed-precondition", "Another appeal is already open for this role.");
    }
    if (data.appeal?.status === "open") {
      if (slotSnapshot.data()?.appealOpenApplicationId !== id) {
        tx.set(slot, { userId: data.userId, type: data.type, appealOpenApplicationId: id,
          updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      return { status: "open", alreadyOpen: true };
    }
    if (nowMs < notice || nowMs > notice + appealWindowMs) throw new HttpsError("failed-precondition", "The appeal request window has closed.");
    tx.update(ref, {
      appeal: { status: "open", openedAt: Timestamp.fromMillis(nowMs), responseDueAt: Timestamp.fromMillis(nowMs + appealResponseMs) },
      recordPurgeAt: FieldValue.delete(),
      documentRetentionBlockedReason: FieldValue.delete(),
      ...nextAttempt(data, nowMs), updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(slot, { userId: data.userId, type: data.type, appealOpenApplicationId: id,
      updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { status: "open", alreadyOpen: false };
  });
}

async function finishAppeal(db, caller, id, outcomeCode, nowMs = Date.now()) {
  requireAdmin(caller);
  eventCode(outcomeCode);
  if (!appealOutcomes.has(outcomeCode)) {
    throw new HttpsError("failed-precondition", "Changing a decision requires a separate trusted review workflow.");
  }
  const ref = applicationRef(db, id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.appeal?.status !== "open") throw new HttpsError("failed-precondition", "No open appeal exists.");
    if (data.appealReversal?.status === "confirmed") {
      throw new HttpsError("failed-precondition", "A confirmed reversal requires reconciliation.");
    }
    noDeletionLease(data, nowMs);
    const slot = slotRef(db, data.userId, data.type);
    const slotSnapshot = await tx.get(slot);
    const history = appendHistory(data.appealHistory, { openedAt: data.appeal.openedAt,
      closedAt: Timestamp.fromMillis(nowMs), outcomeCode, reviewedBy: caller.uid });
    tx.update(ref, {
      appeal: { ...data.appeal, status: "closed", closedAt: Timestamp.fromMillis(nowMs), outcomeCode },
      ...(data.appealReversal?.status === "recommended" ? {
        appealReversal: { ...data.appealReversal, status: "not-confirmed",
          notConfirmedBy: caller.uid, notConfirmedAt: Timestamp.fromMillis(nowMs) }
      } : {}),
      appealHistory: history, protectionReleasedAt: Timestamp.fromMillis(nowMs),
      ...purgeSchedule({ ...data, appeal: { status: "closed", closedAt: Timestamp.fromMillis(nowMs) } }),
      documentRetentionBlockedReason: FieldValue.delete(),
      ...nextAttempt(data, nowMs), updatedAt: FieldValue.serverTimestamp()
    });
    if (slotSnapshot.data()?.appealOpenApplicationId === id) {
      tx.update(slot, { appealOpenApplicationId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    }
    if (data.appealReversal?.status === "recommended") {
      tx.create(db.doc(`applications/${id}/events/reversal-not-confirmed`), {
        applicationId: id, reference: data.reference || null,
        event: "reversal-not-confirmed", actorUid: caller.uid,
        recommendedBy: data.appealReversal.recommendedBy,
        outcomeCode, at: FieldValue.serverTimestamp()
      });
    }
    return { status: "closed" };
  });
}

async function setDispute(db, caller, id, action, reasonCode, nowMs = Date.now()) {
  requireAdmin(caller);
  eventCode(reasonCode);
  if (!["open", "close"].includes(action)) throw new HttpsError("invalid-argument", "Invalid dispute action.");
  const ref = applicationRef(db, id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || !terminal.has(data.status)) throw new HttpsError("failed-precondition", "A completed decision is required.");
    noDeletionLease(data, nowMs);
    if (action === "open") {
      if (data.dispute?.status === "open") return { status: "open", alreadyOpen: true };
      if ((data.disputeHistory || []).length >= maxHistory) throw new HttpsError("resource-exhausted", "Dispute history requires manual review.");
      tx.update(ref, { dispute: { status: "open", reasonCode, openedAt: Timestamp.fromMillis(nowMs), openedBy: caller.uid },
        recordPurgeAt: FieldValue.delete(),
        ...nextAttempt(data, nowMs), updatedAt: FieldValue.serverTimestamp() });
      return { status: "open", alreadyOpen: false };
    }
    if (data.dispute?.status !== "open") throw new HttpsError("failed-precondition", "No active dispute exists.");
    const history = appendHistory(data.disputeHistory, { ...data.dispute, status: "closed", closedAt: Timestamp.fromMillis(nowMs),
      closedBy: caller.uid, outcomeCode: reasonCode });
    tx.update(ref, { dispute: { status: "closed", closedAt: Timestamp.fromMillis(nowMs), outcomeCode: reasonCode },
      disputeHistory: history, protectionReleasedAt: Timestamp.fromMillis(nowMs),
      ...purgeSchedule({ ...data, dispute: { status: "closed", closedAt: Timestamp.fromMillis(nowMs) } }),
      documentRetentionBlockedReason: FieldValue.delete(),
      ...nextAttempt(data, nowMs), updatedAt: FieldValue.serverTimestamp() });
    return { status: "closed" };
  });
}

async function setLegalHold(db, caller, id, action, options = {}, nowMs = Date.now()) {
  requireAdmin(caller);
  if (!["place", "review", "release"].includes(action)) throw new HttpsError("invalid-argument", "Invalid hold action.");
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new HttpsError("invalid-argument", "Hold details are required.");
  }
  const reasonCode = eventCode(options.reasonCode);
  const ref = applicationRef(db, id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || !terminal.has(data.status)) throw new HttpsError("failed-precondition", "A completed decision is required.");
    noDeletionLease(data, nowMs);
    const old = data.legalHold;
    if (action === "place") {
      if (old?.status === "active") throw new HttpsError("already-exists", "A legal hold is active.");
      if ((data.legalHoldHistory || []).length >= maxHistory) throw new HttpsError("resource-exhausted", "Legal hold history requires manual review.");
    } else if (old?.status !== "active") {
      throw new HttpsError("failed-precondition", "No active legal hold exists.");
    }
    if (action !== "release") {
      const reviewDueAtMs = Number(options.reviewDueAtMs);
      if (!Number.isSafeInteger(reviewDueAtMs) || reviewDueAtMs <= nowMs || reviewDueAtMs > nowMs + 90 * dayMs) {
        throw new HttpsError("invalid-argument", "A review date within 90 days is required.");
      }
      const scope = options.scope === "all" ? "all" : null;
      if (!scope) throw new HttpsError("invalid-argument", "Hold scope must be all private application documents.");
      const hold = { status: "active", reasonCode, scope, startedAt: old?.startedAt || Timestamp.fromMillis(nowMs),
        responsibleUid: caller.uid, reviewDueAt: Timestamp.fromMillis(reviewDueAtMs),
        lastReviewedAt: Timestamp.fromMillis(nowMs) };
      tx.update(ref, { legalHold: hold, legalHoldReviewNextAt: Timestamp.fromMillis(reviewDueAtMs),
        recordPurgeAt: FieldValue.delete(),
        legalHoldReviewReminders: 0, legalHoldReviewManual: false,
        ...nextAttempt(data, nowMs), updatedAt: FieldValue.serverTimestamp() });
      return { status: "active", reviewDueAt: new Date(reviewDueAtMs).toISOString() };
    }
    const history = appendHistory(data.legalHoldHistory, { ...old, status: "released", releasedAt: Timestamp.fromMillis(nowMs),
      releasedBy: caller.uid, releaseReasonCode: reasonCode });
    tx.update(ref, { legalHold: { status: "released", releasedAt: Timestamp.fromMillis(nowMs), releaseReasonCode: reasonCode },
      legalHoldHistory: history, protectionReleasedAt: Timestamp.fromMillis(nowMs),
      ...purgeSchedule({ ...data, legalHold: { status: "released" } }),
      legalHoldReviewNextAt: FieldValue.delete(), legalHoldReviewManual: false,
      documentRetentionBlockedReason: FieldValue.delete(),
      ...nextAttempt(data, nowMs), updatedAt: FieldValue.serverTimestamp() });
    return { status: "released" };
  });
}

async function flagOverdueLegalHolds(db, nowMs = Date.now()) {
  const { processDuePages } = require("./job-failures");
  const due = db.collection("applications")
    .where("legalHoldReviewNextAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("legalHoldReviewNextAt");
  let flagged = 0;
  await processDuePages(due, async (snapshot) => {
    const state = await db.runTransaction(async (tx) => {
      const current = await tx.get(snapshot.ref);
      const data = current.data();
      if (data?.legalHold?.status !== "active" || !data.legalHoldReviewNextAt?.toMillis
          || data.legalHoldReviewNextAt.toMillis() > nowMs) return null;
      const reminders = Math.min(3, (data.legalHoldReviewReminders || 0) + 1);
      const manual = reminders >= 3;
      tx.update(snapshot.ref, { legalHoldReviewFlaggedAt: Timestamp.fromMillis(nowMs),
        legalHoldReviewReminders: reminders, legalHoldReviewManual: manual,
        legalHoldReviewNextAt: manual ? FieldValue.delete() : Timestamp.fromMillis(nowMs + 7 * dayMs) });
      return { reminders, manual };
    });
    if (state) {
      flagged += 1;
      console.warn("Legal hold requires review", { applicationId: snapshot.id, ...state });
    }
  });
  return { flagged };
}

async function acquireDeletionLease(db, ref, nowMs) {
  const token = crypto.randomUUID();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || !terminal.has(data.status) || data.documentCleanupPending !== true
        || !data.documentsPurgeAt?.toMillis || data.documentsPurgeAt.toMillis() > nowMs) return null;
    if (data.documentDeletionLease?.until?.toMillis() > nowMs) return null;
    const eligibility = deletionEligibility(data, nowMs);
    if (!eligibility.allowed) {
      tx.update(ref, {
        documentNextAttemptAt: eligibility.nextAt
          ? Timestamp.fromMillis(eligibility.nextAt) : FieldValue.delete(),
        documentRetentionBlockedReason: eligibility.reason
      });
      return null;
    }
    tx.update(ref, { documentDeletionLease: { token, until: Timestamp.fromMillis(nowMs + deletionLeaseMs) } });
    return data;
  });
  return result ? { token, application: result } : null;
}

async function releaseDeletionLease(db, ref, token) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.data()?.documentDeletionLease?.token === token) tx.update(ref, { documentDeletionLease: FieldValue.delete() });
  });
}

module.exports = {
  appealWindowMs, deletionEligibility, confirmNotice, requestAppeal, finishAppeal, setDispute, setLegalHold,
  acquireDeletionLease, releaseDeletionLease, flagOverdueLegalHolds
};
