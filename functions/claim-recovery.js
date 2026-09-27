const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { withClaimLock } = require("./review-workflow");

const roles = new Set(["admin", "vendor", "rider"]);
const code = /^[a-z][a-z0-9-]{1,49}$/;
const operation = /^[A-Za-z0-9-]{10,80}$/;

function auditRef(db, operationId, stage) {
  return db.doc(`claimAuditEvents/revoke-${operationId}-${stage}`);
}

// Trusted backend/recovery tooling only; deliberately not exposed as a callable.
async function revokeRoleForSecurity(db, auth, input, fault = async () => {}) {
  const { uid, role, operationId, actorUid, reasonCode } = input || {};
  if (!uid || uid.includes("/") || !roles.has(role) || !operation.test(String(operationId || ""))
      || !actorUid || actorUid.includes("/") || !code.test(String(reasonCode || ""))) {
    throw new Error("A trusted, coded claim-revocation operation is required.");
  }
  const intent = auditRef(db, operationId, "intent");
  const applied = auditRef(db, operationId, "applied");
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(intent);
    if (existing.exists) {
      const previous = existing.data();
      if (previous.affectedUid !== uid || previous.role !== role
          || previous.actorUid !== actorUid || previous.reasonCode !== reasonCode) {
        throw new Error("Claim-revocation operation ID is already assigned.");
      }
      return;
    }
    const data = { affectedUid: uid, role, operation: "revoke", actorUid,
      source: "trusted-security-recovery", reasonCode,
      result: "reconciliation-pending", at: FieldValue.serverTimestamp() };
    if (role === "admin") {
      const gate = db.doc("adminSecurity/global");
      const gateSnap = await tx.get(gate);
      if (!gateSnap.exists || !Array.isArray(gateSnap.data().blockedUids)) {
        throw new Error("Admin emergency gate must be provisioned before revocation.");
      }
      if (gateSnap.data().blockedUids.includes(uid)) {
        throw new Error("This admin is already emergency-blocked; inspect the prior recovery operation.");
      }
      tx.update(gate, { blockedUids: FieldValue.arrayUnion(uid), bootstrapEnabled: false });
    } else {
      const profile = db.doc(`${role === "vendor" ? "vendors" : "riders"}/${uid}`);
      const profileSnap = await tx.get(profile);
      if (profileSnap.data()?.status === "suspended") {
        throw new Error("This partner is already suspended; inspect the prior recovery operation.");
      }
      if (profileSnap.exists) tx.update(profile, {
        status: "suspended", ...(role === "vendor" ? { acceptingOrders: false } : { available: false }),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    tx.create(intent, data);
  });
  await fault("afterIntent");
  await withClaimLock(db, uid, async () => {
    const user = await auth.getUser(uid);
    if (user.customClaims?.[role] === true) {
      const next = { ...(user.customClaims || {}) };
      delete next[role];
      await auth.setCustomUserClaims(uid, next);
    }
    await auth.revokeRefreshTokens(uid);
  });
  await fault("afterAuth");
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(applied);
    if (existing.exists) return;
    const closedAt = Timestamp.now();
    const auditNextAttemptAt = Timestamp.fromMillis(closedAt.toMillis() + 180 * 86400000);
    const bootstrapRefs = role === "admin" ? [
      db.doc(`claimAuditEvents/bootstrap-${uid}-intent`),
      db.doc(`claimAuditEvents/bootstrap-${uid}-applied`)
    ] : [];
    const bootstrapEvents = await Promise.all(bootstrapRefs.map((ref) => tx.get(ref)));
    tx.set(db.doc(`users/${uid}`), { roles: FieldValue.arrayRemove(role),
      updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (role === "admin") {
      tx.update(intent, { caseClosedAt: closedAt, auditNextAttemptAt });
      bootstrapEvents.forEach((event) => {
        if (event.exists) tx.update(event.ref, { caseClosedAt: closedAt, auditNextAttemptAt });
      });
    }
    tx.create(applied, { affectedUid: uid, role, operation: "revoke", actorUid,
      source: "trusted-security-recovery", reasonCode,
      result: "applied", at: FieldValue.serverTimestamp(),
      ...(role === "admin" ? { caseClosedAt: closedAt, auditNextAttemptAt } : {}) });
  });
  return { uid, role, status: "revoked" };
}

module.exports = { revokeRoleForSecurity };
