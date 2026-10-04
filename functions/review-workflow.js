const crypto = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { slotRef } = require("./application-workflow");
const { scheduleDocuments } = require("./retention-workflow");
const { recordFailure, processDuePages, archiveResolvedFailure } = require("./job-failures");
const { requireReviewActorsActive } = require("./admin-security");

const lockMs = 2 * 60 * 1000;
const statuses = new Set(["approved", "declined"]);
const validId = /^[A-Za-z0-9]{10,40}$/;
const validCode = /^[a-z][a-z0-9-]{1,49}$/;

function requireReviewer(caller) {
  if (!caller?.uid || caller.token?.admin !== true || caller.token?.email_verified !== true) {
    throw new HttpsError("permission-denied", "Verified admin access is required.");
  }
}

function auditRef(db, applicationId, event) {
  return db.doc(`applications/${applicationId}/events/${event}`);
}

function claimAuditRef(db, applicationId, role, stage) {
  return db.doc(`claimAuditEvents/${applicationId}-${role}-${stage}`);
}

function claimAuditData(application, role, stage, actorUid, source) {
  return {
    affectedUid: application.userId, applicationId: application.id,
    reference: application.reference || null, role, operation: "grant", actorUid,
    source, result: stage === "applied" ? "applied" : "reconciliation-pending",
    reasonCode: (source === "appeal-reversal" ? application.appealReversal?.reasonCode
      : application.decisionReasonCode) || "not-provided",
    at: FieldValue.serverTimestamp()
  };
}

function roleFor(type) {
  if (type === "cook") return "vendor";
  if (type === "rider") return "rider";
  throw new HttpsError("failed-precondition", "Invalid partner application type.");
}

async function requireActivePartnerProfile(db, role, uid, applicationId) {
  const collection = role === "vendor" ? "vendors" : "riders";
  const profile = await db.doc(`${collection}/${uid}`).get();
  if (profile.data()?.status !== "approved" || profile.data()?.applicationId !== applicationId) {
    throw new HttpsError("failed-precondition", "Partner profile is no longer approved for claim reconciliation.");
  }
}

function lockRef(db, uid) {
  return db.doc(`applicationClaimLocks/${crypto.createHash("sha256").update(uid).digest("hex")}`);
}

async function withClaimLock(db, uid, action) {
  const ref = lockRef(db, uid);
  const token = crypto.randomUUID();
  await db.runTransaction(async (transaction) => {
    const lock = await transaction.get(ref);
    if (lock.exists && lock.data().until?.toMillis() > Date.now()) {
      throw new HttpsError("unavailable", "Role update is busy. Retry shortly.");
    }
    transaction.set(ref, { token, until: Timestamp.fromMillis(Date.now() + lockMs) });
  });
  try {
    return await action();
  } finally {
    await db.runTransaction(async (transaction) => {
      const lock = await transaction.get(ref);
      if (lock.data()?.token === token) transaction.delete(ref);
    }).catch((error) => console.error("Claim lock release requires retry", { uid, error }));
  }
}

async function reserveReview(db, caller, applicationId, decision, reasonCode = "not-provided") {
  requireReviewer(caller);
  if (!validId.test(String(applicationId || "")) || !statuses.has(decision)) {
    throw new HttpsError("invalid-argument", "Invalid application or review decision.");
  }
  if (!validCode.test(String(reasonCode))) {
    throw new HttpsError("invalid-argument", "Invalid coded review reason.");
  }
  const ref = db.doc(`applications/${applicationId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "Application not found.");
    const current = snapshot.data();
    roleFor(current.type);
    if (current.status === decision && current.reviewDecision === decision) return;
    if (current.status === "reviewing" && current.reviewDecision === decision) return;
    if (current.status !== "pending") {
      throw new HttpsError("failed-precondition", "This application has already received a different decision.");
    }
    transaction.update(ref, {
      status: "reviewing", reviewDecision: decision, decisionReasonCode: reasonCode, reviewedBy: caller.uid,
      reviewNeedsReconcile: true, reviewNextAttemptAt: Timestamp.now(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
}

async function finishReview(db, auth, applicationId, retentionDays = {}, fault = async () => {}) {
  const ref = db.doc(`applications/${applicationId}`);
  let snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Application not found.");
  let application = snapshot.data();
  const decision = application.reviewDecision;
  const role = roleFor(application.type);
  if (!statuses.has(decision) || !["reviewing", decision].includes(application.status)) {
    throw new HttpsError("failed-precondition", "Application is not reserved for this review.");
  }
  if (application.reviewNeedsReconcile !== true) {
    return { applicationId, status: decision, role: decision === "approved" ? role : null };
  }
  await requireReviewActorsActive(db, [application.reviewedBy]);
  await fault("afterReservation");

  if (application.status === "reviewing") {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.data()?.status === decision && current.data()?.reviewDecision === decision) return;
      if (current.data()?.status !== "reviewing" || current.data()?.reviewDecision !== decision) {
        throw new HttpsError("failed-precondition", "Review decision changed.");
      }
      const data = current.data();
      const schedule = scheduleDocuments(data.documents || [], decision, retentionDays);
      const retention = schedule.nextPurgeAt
        ? {
          documents: schedule.documents,
          documentsPurgeAt: schedule.nextPurgeAt,
          documentNextAttemptAt: schedule.nextPurgeAt,
          documentCleanupPending: true
        }
        : {};
      transaction.update(ref, {
        status: decision, verificationOutcome: decision, reviewedAt: FieldValue.serverTimestamp(),
        noticeChannelCode: "verified-email", noticeRevision: 1, noticeConfirmationPending: true,
        pendingReviewAlertAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(), ...retention
      });
      transaction.create(auditRef(db, applicationId, "initial-decision"), {
        applicationId, reference: data.reference || null, event: "initial-decision",
        previousStatus: "pending", decision, reasonCode: data.decisionReasonCode,
        actorUid: data.reviewedBy, at: FieldValue.serverTimestamp()
      });
      transaction.set(slotRef(db, data.userId, data.type), {
        userId: data.userId, type: data.type, applicationId,
        status: decision, updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      if (decision === "approved") {
        const intent = claimAuditData({ ...data, id: applicationId }, role, "intent", data.reviewedBy, "initial-review");
        transaction.create(claimAuditRef(db, applicationId, role, "intent"), intent);
        transaction.set(db.doc(`users/${data.userId}`), {
          roles: FieldValue.arrayUnion(role), updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        transaction.set(db.doc(`${role === "vendor" ? "vendors" : "riders"}/${data.userId}`), {
          userId: data.userId, ownerId: data.userId, applicationId, status: "approved",
          ...(role === "vendor" ? {
            kitchenName: data.fields?.businessName || "Mama Meals Partner Kitchen",
            serviceArea: data.fields?.serviceArea || "Nairobi",
            about: "Fresh local meals prepared with care.",
            acceptingOrders: false
          } : { available: false }),
          approvedAt: FieldValue.serverTimestamp(), approvedBy: data.reviewedBy,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });
  }
  await fault("afterFirestoreCommit");
  snapshot = await ref.get();
  application = snapshot.data();
  if (decision === "approved") {
    await requireReviewActorsActive(db, [application.reviewedBy]);
    await requireActivePartnerProfile(db, role, application.userId, applicationId);
    await withClaimLock(db, application.userId, async () => {
      await requireReviewActorsActive(db, [application.reviewedBy]);
      await requireActivePartnerProfile(db, role, application.userId, applicationId);
      const user = await auth.getUser(application.userId);
      if (user.customClaims?.[role] !== true) {
        await auth.setCustomUserClaims(application.userId, {
          ...(user.customClaims || {}), customer: true, [role]: true
        });
      }
    });
  }
  await fault("afterClaimSync");
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (current.data()?.status === decision && current.data()?.reviewDecision === decision
        && current.data()?.reviewNeedsReconcile === true) {
      if (decision === "approved") {
        const applied = claimAuditRef(db, applicationId, role, "applied");
        const existing = await transaction.get(applied);
        if (!existing.exists) transaction.create(applied, claimAuditData({ ...current.data(), id: applicationId },
          role, "applied", current.data().reviewedBy, "initial-review"));
      }
      archiveResolvedFailure(transaction, db, applicationId, "review", current.data().jobFailures?.review);
      transaction.update(ref, {
        reviewNeedsReconcile: false, reviewNextAttemptAt: FieldValue.delete(),
        "jobFailures.review": FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });
  return { applicationId, status: decision, role: decision === "approved" ? role : null };
}

async function recommendAppealReversal(db, caller, applicationId, reasonCode) {
  requireReviewer(caller);
  if (!validId.test(String(applicationId || "")) || !validCode.test(String(reasonCode || ""))) {
    throw new HttpsError("invalid-argument", "An application and coded reason are required.");
  }
  const ref = db.doc(`applications/${applicationId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!data || data.status !== "declined" || data.appeal?.status !== "open"
        || data.documentDeletionLease?.until?.toMillis() > Date.now()) {
      throw new HttpsError("failed-precondition", "An open, protected declined appeal is required.");
    }
    roleFor(data.type);
    if (data.appealReversal) {
      if (data.appealReversal.recommendedBy === caller.uid
          && data.appealReversal.reasonCode === reasonCode) return { status: data.appealReversal.status, alreadyRecommended: true };
      throw new HttpsError("failed-precondition", "This appeal already has a reversal recommendation.");
    }
    transaction.update(ref, { appealReversal: {
      status: "recommended", recommendedBy: caller.uid, reasonCode,
      recommendedAt: FieldValue.serverTimestamp()
    }, updatedAt: FieldValue.serverTimestamp() });
    transaction.create(auditRef(db, applicationId, "reversal-recommended"), {
      applicationId, reference: data.reference || null, event: "reversal-recommended",
      actorUid: caller.uid, reasonCode, at: FieldValue.serverTimestamp()
    });
    return { status: "recommended", alreadyRecommended: false };
  });
}

async function confirmAppealReversal(db, auth, caller, applicationId, reasonCode, retentionDays, fault = async () => {}) {
  requireReviewer(caller);
  if (!validId.test(String(applicationId || "")) || !validCode.test(String(reasonCode || ""))) {
    throw new HttpsError("invalid-argument", "An application and coded reason are required.");
  }
  const ref = db.doc(`applications/${applicationId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const reversal = data?.appealReversal;
    if (!data || !reversal || !["recommended", "confirmed"].includes(reversal.status)
        || reversal.recommendedBy === caller.uid || (data.status !== "declined" && data.status !== "approved")
        || data.documentDeletionLease?.until?.toMillis() > Date.now()) {
      throw new HttpsError("failed-precondition", "A distinct second reviewer and protected appeal are required.");
    }
    if (reversal.status === "confirmed") {
      if (reversal.confirmedBy !== caller.uid || reversal.confirmationReasonCode !== reasonCode) {
        throw new HttpsError("failed-precondition", "This reversal has already been confirmed by another reviewer.");
      }
      return;
    }
    if (data.appeal?.status !== "open" || data.status !== "declined") {
      throw new HttpsError("failed-precondition", "The declined appeal is no longer open.");
    }
    transaction.update(ref, {
      appealReversal: { ...reversal, status: "confirmed", confirmedBy: caller.uid,
        confirmationReasonCode: reasonCode, confirmedAt: FieldValue.serverTimestamp() },
      reviewNeedsReconcile: true, reviewNextAttemptAt: Timestamp.now(),
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.create(auditRef(db, applicationId, "reversal-confirmed"), {
      applicationId, reference: data.reference || null, event: "reversal-confirmed",
      actorUid: caller.uid, reasonCode, at: FieldValue.serverTimestamp()
    });
  });
  return finishAppealReversal(db, auth, applicationId, retentionDays, fault);
}

async function finishAppealReversal(db, auth, applicationId, retentionDays, fault = async () => {}) {
  const ref = db.doc(`applications/${applicationId}`);
  let snapshot = await ref.get();
  const data = snapshot.data();
  const reversal = data?.appealReversal;
  if (!data || reversal?.status !== "confirmed" || reversal.recommendedBy === reversal.confirmedBy
      || !reversal.confirmedBy || !["declined", "approved"].includes(data.status)) {
    throw new HttpsError("failed-precondition", "A confirmed two-reviewer reversal is required.");
  }
  const role = roleFor(data.type);
  if (data.reviewNeedsReconcile !== true) return { applicationId, status: "approved", role };
  await requireReviewActorsActive(db, [reversal.recommendedBy, reversal.confirmedBy]);
  await fault("afterReservation");
  if (data.status === "declined") {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      const application = current.data();
      const slot = slotRef(db, application.userId, application.type);
      const slotSnapshot = await transaction.get(slot);
      if (application.status === "approved" && application.appealReversal?.status === "confirmed") return;
      if (application.status !== "declined" || application.appeal?.status !== "open"
          || application.appealReversal?.status !== "confirmed"
          || application.documentDeletionLease?.until?.toMillis() > Date.now()
          || slotSnapshot.data()?.appealOpenApplicationId !== applicationId
          || (slotSnapshot.data()?.applicationId && slotSnapshot.data().applicationId !== applicationId)) {
        throw new HttpsError("failed-precondition", "Appeal or same-role application changed; reversal needs manual review.");
      }
      const documents = application.documents || [];
      if (!documents.length || application.documentCleanupPending !== true) {
        throw new HttpsError("failed-precondition", "Protected documents are required for reversal.");
      }
      if ((application.appealHistory || []).length >= 20) {
        throw new HttpsError("resource-exhausted", "Appeal history requires manual review.");
      }
      const schedule = scheduleDocuments(documents, "approved", retentionDays);
      transaction.update(ref, {
        status: "approved", reviewDecision: "approved", verificationOutcome: "approved",
        decisionReasonCode: application.appealReversal.reasonCode,
        reviewedBy: application.appealReversal.confirmedBy, reviewedAt: FieldValue.serverTimestamp(),
        appeal: { ...application.appeal, status: "closed", outcomeCode: "reversed",
          closedAt: FieldValue.serverTimestamp() },
        appealHistory: [...(application.appealHistory || []), {
          openedAt: application.appeal.openedAt, closedAt: Timestamp.now(), outcomeCode: "reversed",
          recommendedBy: application.appealReversal.recommendedBy,
          confirmedBy: application.appealReversal.confirmedBy
        }],
        noticeConfirmedAt: FieldValue.delete(), noticeConfirmedBy: FieldValue.delete(),
        noticeMethodCode: FieldValue.delete(), noticeChannelCode: "verified-email",
        noticeRevision: (application.noticeRevision || 1) + 1, noticeConfirmationPending: true,
        protectionReleasedAt: Timestamp.now(),
        documents: schedule.documents, documentsPurgeAt: schedule.nextPurgeAt,
        documentNextAttemptAt: schedule.nextPurgeAt, documentCleanupPending: true,
        updatedAt: FieldValue.serverTimestamp()
      });
      transaction.update(slot, { applicationId, status: "approved", appealOpenApplicationId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp() });
      transaction.set(db.doc(`users/${application.userId}`), {
        roles: FieldValue.arrayUnion(role), updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(db.doc(`${role === "vendor" ? "vendors" : "riders"}/${application.userId}`), {
        userId: application.userId, ownerId: application.userId, applicationId, status: "approved",
        ...(role === "vendor" ? {
          kitchenName: application.fields?.businessName || "Mama Meals Partner Kitchen",
          serviceArea: application.fields?.serviceArea || "Nairobi",
          about: "Fresh local meals prepared with care.",
          acceptingOrders: false
        } : { available: false }),
        approvedAt: FieldValue.serverTimestamp(), approvedBy: application.appealReversal.confirmedBy,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.create(auditRef(db, applicationId, "reversal-approved"), {
        applicationId, reference: application.reference || null, event: "reversal-approved",
        previousStatus: "declined", decision: "approved",
        recommendedBy: application.appealReversal.recommendedBy,
        confirmedBy: application.appealReversal.confirmedBy,
        reasonCode: application.appealReversal.reasonCode, at: FieldValue.serverTimestamp()
      });
      transaction.create(claimAuditRef(db, applicationId, role, "reversal-intent"),
        claimAuditData({ ...application, id: applicationId }, role, "intent",
          application.appealReversal.confirmedBy, "appeal-reversal"));
    });
  }
  await fault("afterFirestoreCommit");
  snapshot = await ref.get();
  const application = snapshot.data();
  await requireReviewActorsActive(db, [application.appealReversal.recommendedBy,
    application.appealReversal.confirmedBy]);
  await requireActivePartnerProfile(db, role, application.userId, applicationId);
  await withClaimLock(db, application.userId, async () => {
    await requireReviewActorsActive(db, [application.appealReversal.recommendedBy,
      application.appealReversal.confirmedBy]);
    await requireActivePartnerProfile(db, role, application.userId, applicationId);
    const user = await auth.getUser(application.userId);
    if (user.customClaims?.[role] !== true) {
      await auth.setCustomUserClaims(application.userId, {
        ...(user.customClaims || {}), customer: true, [role]: true
      });
    }
  });
  await fault("afterClaimSync");
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const applied = claimAuditRef(db, applicationId, role, "reversal-applied");
    const existing = await transaction.get(applied);
    if (current.data()?.reviewNeedsReconcile !== true) return;
    if (!existing.exists) transaction.create(applied, claimAuditData({ ...current.data(), id: applicationId },
      role, "applied", current.data().appealReversal.confirmedBy, "appeal-reversal"));
    archiveResolvedFailure(transaction, db, applicationId, "review", current.data().jobFailures?.review);
    transaction.update(ref, { reviewNeedsReconcile: false,
      reviewNextAttemptAt: FieldValue.delete(), "jobFailures.review": FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp() });
  });
  return { applicationId, status: "approved", role };
}

async function reconcileReviews(db, auth, retentionDays = {}, nowMs = Date.now()) {
  const gate = await db.doc("adminSecurity/global").get();
  if (gate.data()?.enabled !== true) return { recovered: 0, suspended: true };
  const due = db.collection("applications")
    .where("reviewNeedsReconcile", "==", true)
    .where("reviewNextAttemptAt", "<=", Timestamp.fromMillis(nowMs))
    .orderBy("reviewNextAttemptAt");
  let recovered = 0;
  await processDuePages(due, async (item) => {
    try {
      if (item.data().appealReversal?.status === "confirmed") {
        await finishAppealReversal(db, auth, item.id, retentionDays);
      } else {
        await finishReview(db, auth, item.id, retentionDays);
      }
      recovered += 1;
    } catch (error) {
      await recordFailure(db, item.ref, "review", "reviewNextAttemptAt",
        (current) => current.reviewNeedsReconcile === true, error);
    }
  });
  return { recovered };
}

module.exports = { reserveReview, finishReview, reconcileReviews, withClaimLock,
  recommendAppealReversal, confirmAppealReversal, finishAppealReversal };
