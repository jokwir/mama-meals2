const { HttpsError } = require("firebase-functions/v2/https");

const configPath = "adminSecurity/global";

async function requireAdminAccess(db, caller) {
  if (!caller?.uid || caller.token?.admin !== true || caller.token?.email_verified !== true) {
    throw new HttpsError("permission-denied", "Verified admin access is required.");
  }
  const snapshot = await db.doc(configPath).get();
  const policy = snapshot.data();
  if (policy?.enabled !== true || !Array.isArray(policy.blockedUids)
      || policy.blockedUids.includes(caller.uid)) {
    throw new HttpsError("permission-denied", "Admin operations are suspended for this account.");
  }
  return caller;
}

async function requireBootstrapAccess(db, caller, initialAdminUid) {
  if (!caller?.uid || caller.uid !== initialAdminUid || caller.token?.email_verified !== true) {
    throw new HttpsError("permission-denied", "This account is not authorized to bootstrap administration.");
  }
  const snapshot = await db.doc(configPath).get();
  const policy = snapshot.data();
  if (policy?.enabled !== true || policy.bootstrapEnabled !== true
      || !Array.isArray(policy.blockedUids) || policy.blockedUids.includes(caller.uid)) {
    throw new HttpsError("permission-denied", "Admin bootstrap is suspended or retired.");
  }
  return caller;
}

async function requireReviewActorsActive(db, actorUids) {
  const snapshot = await db.doc(configPath).get();
  const policy = snapshot.data();
  if (policy?.enabled !== true || !Array.isArray(policy.blockedUids)
      || actorUids.some((uid) => !uid || policy.blockedUids.includes(uid))) {
    throw new HttpsError("permission-denied", "Admin review reconciliation is suspended.");
  }
}

module.exports = { configPath, requireAdminAccess, requireBootstrapAccess, requireReviewActorsActive };
