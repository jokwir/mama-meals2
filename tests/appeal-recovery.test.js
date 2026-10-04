const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
const { getFirestore, Timestamp } = functionsRequire("firebase-admin/firestore");
const workflow = require("../functions/application-workflow");
const review = require("../functions/review-workflow");
const protection = require("../functions/application-protection");
const adminSecurity = require("../functions/admin-security");
const { revokeRoleForSecurity } = require("../functions/claim-recovery");
const auditRetention = require("../functions/audit-retention");

const admin = (uid) => ({ uid, token: { admin: true, email_verified: true } });
const policy = { approved: 7, declined: 30 };
let app;
let db;

function authStore() {
  const claims = new Map();
  const revoked = new Set();
  return {
    claims, revoked,
    async getUser(uid) { return { customClaims: claims.get(uid) || {} }; },
    async setCustomUserClaims(uid, next) { claims.set(uid, next); },
    async revokeRefreshTokens(uid) { revoked.add(uid); }
  };
}

async function appealed(type = "cook") {
  const user = { uid: `owner${randomUUID().replace(/-/g, "")}`, token: { email_verified: true } };
  const draft = await workflow.startDraft(db, { getFiles: async () => [[]] }, user, type,
    type === "cook" ? { businessName: "Test Appeal Kitchen", serviceArea: "Lavington",
      fullName: "Private applicant name", experience: "Private application review notes" } : {});
  const applicationId = draft.applicationId;
  const field = type === "cook" ? "identityDocument" : "identityPhoto";
  await workflow.submitDraft(db, user, applicationId, async () => [{
    field, path: workflow.objectPath(user.uid, applicationId, type, field), generation: "7"
  }], "TEST-REFERENCE");
  const auth = authStore();
  await review.reserveReview(db, admin("reviewer-one"), applicationId, "declined", "failed-check");
  await review.finishReview(db, auth, applicationId, policy);
  await db.doc(`applicationNoticeReceipts/${applicationId}`).set({
    recipientUid: user.uid, revision: 1, channelCode: "verified-email",
    deliveryEvidenceCode: "provider-confirmed", sendAttemptAt: Timestamp.now(),
    confirmedAt: Timestamp.now()
  });
  await protection.confirmNotice(db, admin("reviewer-one"), applicationId, "verified-email");
  await protection.requestAppeal(db, user, applicationId);
  return { user, applicationId, ref: db.doc(`applications/${applicationId}`), auth };
}

before(async () => {
  app = initializeApp({ projectId: "demo-mama-meals-appeal-recovery" }, `appeal-${process.pid}`);
  db = getFirestore(app);
  await db.doc(adminSecurity.configPath).set({ enabled: true, bootstrapEnabled: true, blockedUids: [] });
});
after(async () => { await deleteApp(app); });

for (const boundary of ["afterReservation", "afterFirestoreCommit", "afterClaimSync"]) {
  test(`two-reviewer reversal recovers from ${boundary}`, async () => {
    const item = await appealed();
    await review.recommendAppealReversal(db, admin("reviewer-one"), item.applicationId, "verified-on-appeal");
    await assert.rejects(review.confirmAppealReversal(db, item.auth, admin("reviewer-two"),
      item.applicationId, "second-check", policy, async (stage) => {
        if (stage === boundary) throw new Error("simulated crash");
      }), /simulated crash/);
    assert.equal((await item.ref.get()).data().reviewNeedsReconcile, true);
    await review.finishAppealReversal(db, item.auth, item.applicationId, policy);
    const final = (await item.ref.get()).data();
    assert.equal(final.status, "approved");
    assert.equal(final.reviewNeedsReconcile, false);
    assert.equal(final.appeal.status, "closed");
    assert.equal(item.auth.claims.get(item.user.uid).vendor, true);
    assert.equal((await db.doc(`vendors/${item.user.uid}`).get()).data().status, "approved");
    const vendor = (await db.doc(`vendors/${item.user.uid}`).get()).data();
    assert.equal(vendor.kitchenName, "Test Appeal Kitchen");
    assert.equal(vendor.serviceArea, "Lavington");
    assert.equal(JSON.stringify(vendor).includes("Private"), false);
    assert.equal((await db.doc(`applications/${item.applicationId}/events/initial-decision`).get()).data().decision, "declined");
    assert.equal((await db.doc(`applications/${item.applicationId}/events/reversal-approved`).get()).data().decision, "approved");
    assert.equal((await db.doc(`claimAuditEvents/${item.applicationId}-vendor-reversal-applied`).get()).data().result, "applied");
    await assert.rejects(protection.confirmNotice(db, admin("reviewer-two"), item.applicationId,
      "verified-email"), /delivery confirmation is unavailable/);
    assert.equal((await review.finishAppealReversal(db, item.auth, item.applicationId, policy)).status, "approved");
    assert.equal((await review.confirmAppealReversal(db, item.auth, admin("reviewer-two"),
      item.applicationId, "second-check", policy)).status, "approved");
  });
}

test("reversal denies the same reviewer and non-admin callers", async () => {
  const item = await appealed("rider");
  await assert.rejects(review.recommendAppealReversal(db, item.user, item.applicationId, "verified-on-appeal"), /admin access/);
  await review.recommendAppealReversal(db, admin("reviewer-one"), item.applicationId, "verified-on-appeal");
  await assert.rejects(review.confirmAppealReversal(db, item.auth, admin("reviewer-one"),
    item.applicationId, "second-check", policy), /distinct second reviewer/);
  await assert.rejects(review.confirmAppealReversal(db, item.auth, item.user,
    item.applicationId, "second-check", policy), /admin access/);
  assert.equal(item.auth.claims.get(item.user.uid), undefined);
  assert.equal((await item.ref.get()).data().status, "declined");
});

test("an unconfirmed recommendation can end as an upheld decline without granting authority", async () => {
  const item = await appealed();
  await review.recommendAppealReversal(db, admin("reviewer-one"), item.applicationId, "verified-on-appeal");
  await protection.finishAppeal(db, admin("reviewer-two"), item.applicationId, "upheld");
  assert.equal((await item.ref.get()).data().status, "declined");
  assert.equal((await item.ref.get()).data().appealReversal.status, "not-confirmed");
  assert.equal((await db.doc(`applications/${item.applicationId}/events/reversal-not-confirmed`).get()).exists, true);
  await assert.rejects(review.confirmAppealReversal(db, item.auth, admin("reviewer-two"),
    item.applicationId, "second-check", policy), /distinct second reviewer/);
  assert.equal(item.auth.claims.get(item.user.uid), undefined);
});

test("emergency suspension stops a partially committed reversal from granting a claim", async () => {
  const item = await appealed();
  await review.recommendAppealReversal(db, admin("reviewer-one"), item.applicationId, "verified-on-appeal");
  await assert.rejects(review.confirmAppealReversal(db, item.auth, admin("reviewer-two"),
    item.applicationId, "second-check", policy, async (stage) => {
      if (stage === "afterFirestoreCommit") {
        await db.doc(adminSecurity.configPath).update({ enabled: false });
        throw new Error("simulated emergency");
      }
    }), /simulated emergency/);
  await assert.rejects(review.finishAppealReversal(db, item.auth, item.applicationId, policy), /suspended/);
  assert.equal(item.auth.claims.get(item.user.uid), undefined);
  assert.deepEqual(await review.reconcileReviews(db, item.auth, policy), { recovered: 0, suspended: true });
  await db.doc(adminSecurity.configPath).update({ enabled: true });
  assert.equal((await review.reconcileReviews(db, item.auth, policy)).recovered, 1);
  assert.equal(item.auth.claims.get(item.user.uid).vendor, true);
});

test("admin emergency gate fails closed for missing, suspended and blocked policies", async () => {
  const caller = admin("reviewer-one");
  await db.doc(adminSecurity.configPath).delete();
  await assert.rejects(adminSecurity.requireAdminAccess(db, caller), /suspended/);
  await db.doc(adminSecurity.configPath).set({ enabled: false, bootstrapEnabled: false, blockedUids: [] });
  await assert.rejects(adminSecurity.requireAdminAccess(db, caller), /suspended/);
  await db.doc(adminSecurity.configPath).set({ enabled: true, bootstrapEnabled: false, blockedUids: [caller.uid] });
  await assert.rejects(adminSecurity.requireAdminAccess(db, caller), /suspended/);
  await db.doc(adminSecurity.configPath).set({ enabled: true, bootstrapEnabled: false, blockedUids: [] });
  assert.equal(await adminSecurity.requireAdminAccess(db, caller), caller);
  await assert.rejects(adminSecurity.requireBootstrapAccess(db, caller, caller.uid), /suspended or retired/);
  await db.doc(adminSecurity.configPath).set({ enabled: true, bootstrapEnabled: true, blockedUids: [] });
  assert.equal(await adminSecurity.requireBootstrapAccess(db, caller, caller.uid), caller);
  await assert.rejects(adminSecurity.requireBootstrapAccess(db, caller, "another-uid"), /not authorized/);
});

for (const boundary of ["afterIntent", "afterAuth"]) {
  test(`trusted admin revocation and audit recover from ${boundary}`, async () => {
    const uid = `admin${randomUUID().replace(/-/g, "")}`;
    const auth = authStore();
    auth.claims.set(uid, { admin: true, customer: true });
    await db.doc(adminSecurity.configPath).set({ enabled: true, bootstrapEnabled: false, blockedUids: [] });
    const input = { uid, role: "admin", operationId: randomUUID(),
      actorUid: "trusted-operator", reasonCode: "compromised-account" };
    await assert.rejects(revokeRoleForSecurity(db, auth, input, async (stage) => {
      if (stage === boundary) throw new Error("simulated crash");
    }), /simulated crash/);
    await assert.rejects(adminSecurity.requireAdminAccess(db, admin(uid)), /suspended/);
    assert.equal((await db.doc(adminSecurity.configPath).get()).data().bootstrapEnabled, false);
    assert.equal((await db.doc(`claimAuditEvents/revoke-${input.operationId}-intent`).get()).data().result,
      "reconciliation-pending");
    assert.equal((await revokeRoleForSecurity(db, auth, input)).status, "revoked");
    assert.equal(auth.claims.get(uid).admin, undefined);
    assert.equal(auth.revoked.has(uid), true);
    assert.equal((await db.doc(`claimAuditEvents/revoke-${input.operationId}-applied`).get()).data().result, "applied");
    assert.equal((await revokeRoleForSecurity(db, auth, input)).status, "revoked");
    await assert.rejects(revokeRoleForSecurity(db, auth, { ...input, uid: "different-account" }),
      /already assigned/);
    const applied = db.doc(`claimAuditEvents/revoke-${input.operationId}-applied`);
    const auditDue = (await applied.get()).data().auditNextAttemptAt.toMillis();
    assert.equal((await auditRetention.purgeDueClaimAuditEvents(db, auditDue - 1)).purged, 0);
    assert.equal((await auditRetention.purgeDueClaimAuditEvents(db, auditDue)).purged >= 1, true);
    assert.equal((await applied.get()).exists, false);
    await assert.rejects(revokeRoleForSecurity(db, auth, input), /already emergency-blocked/);
  });
}

test("trusted partner revocation suspends the profile before stale claims can be used", async () => {
  const uid = `vendor${randomUUID().replace(/-/g, "")}`;
  const auth = authStore();
  auth.claims.set(uid, { vendor: true, customer: true });
  const profile = db.doc(`vendors/${uid}`);
  await profile.set({ userId: uid, ownerId: uid, status: "approved", acceptingOrders: true });
  const input = { uid, role: "vendor", operationId: randomUUID(),
    actorUid: "trusted-operator", reasonCode: "security-suspension" };
  await assert.rejects(revokeRoleForSecurity(db, auth, input, async (stage) => {
    if (stage === "afterIntent") throw new Error("simulated crash");
  }), /simulated crash/);
  assert.equal((await profile.get()).data().status, "suspended");
  assert.equal((await profile.get()).data().acceptingOrders, false);
  assert.equal(auth.claims.get(uid).vendor, true);
  await revokeRoleForSecurity(db, auth, input);
  assert.equal(auth.claims.get(uid).vendor, undefined);
  assert.equal(auth.revoked.has(uid), true);
});

test("suspended partner profile prevents partial reversal reconciliation from regranting a claim", async () => {
  const item = await appealed();
  await review.recommendAppealReversal(db, admin("reviewer-one"), item.applicationId, "verified-on-appeal");
  await assert.rejects(review.confirmAppealReversal(db, item.auth, admin("reviewer-two"),
    item.applicationId, "second-check", policy, async (stage) => {
      if (stage === "afterFirestoreCommit") throw new Error("simulated crash");
    }), /simulated crash/);
  await revokeRoleForSecurity(db, item.auth, { uid: item.user.uid, role: "vendor",
    operationId: randomUUID(), actorUid: "trusted-operator", reasonCode: "security-suspension" });
  await assert.rejects(review.finishAppealReversal(db, item.auth, item.applicationId, policy),
    /no longer approved/);
  assert.equal(item.auth.claims.get(item.user.uid)?.vendor, undefined);
});
