const { createRequire } = require("node:module");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { FieldPath, Timestamp } = functionsRequire("firebase-admin/firestore");

const kinds = ["expiry", "cleanup", "review", "retention", "minimization", "record-purge"];
const dueFields = Object.freeze({
  expiry: "expiryNextAttemptAt", cleanup: "finalCleanupAfter", review: "reviewNextAttemptAt",
  retention: "documentNextAttemptAt", minimization: "recordMinimizeAt", "record-purge": "recordPurgeAt"
});
const safeCodes = new Set([
  "unknown", "not-found", "permission-denied", "failed-precondition", "invalid-argument",
  "unavailable", "internal", "deadline-exceeded", "resource-exhausted", "aborted",
  "storage-not-found", "storage-unknown", "storage-unauthorized"
]);
const legacyCollections = new Set(["vendorApplications", "riderApplications", "users", "vendors", "riders", "menuItems"]);
const inspectionFields = [
  "status", "expiryNextAttemptAt", "cleanupPending", "finalCleanupAfter", "cleanupAt",
  "reviewNeedsReconcile", "reviewNextAttemptAt", "reviewedAt", "documentCleanupPending",
  "documentNextAttemptAt", "documentsPurgedAt", "recordMinimizePending", "recordMinimizeAt",
  "recordMinimizedAt", "recordPurgeAt", "jobFailures"
];
const legacyFields = Object.freeze({
  vendorApplications: ["status", "userId"], riderApplications: ["status", "userId"],
  users: ["role", "roles"], vendors: ["ownerId", "userId", "businessName", "kitchenName"],
  riders: ["ownerId", "userId"],
  menuItems: ["available", "isAvailable", "imageUrl", "imagePath", "vendorOwnerId"]
});
const dayMs = 86400000;

function timestampMs(value) {
  const ms = value?.toMillis?.();
  return Number.isSafeInteger(ms) ? ms : null;
}

function safeCode(value) {
  return safeCodes.has(value) ? value : "unknown";
}

function activeJob(data, kind) {
  if (kind === "expiry") return data.status === "draft";
  if (kind === "cleanup") return data.cleanupPending === true;
  if (kind === "review") return data.reviewNeedsReconcile === true;
  if (kind === "retention") return data.documentCleanupPending === true;
  if (kind === "record-purge") return !!data.recordPurgeAt;
  return data.recordMinimizePending === true;
}

function resolvedJob(data, kind) {
  if (kind === "expiry") return data.status === "expired";
  if (kind === "cleanup") return data.cleanupPending === false && !!data.cleanupAt;
  if (kind === "review") return data.reviewNeedsReconcile === false && !!data.reviewedAt;
  if (kind === "retention") return data.documentCleanupPending === false && !!data.documentsPurgedAt;
  if (kind === "record-purge") return false;
  return data.recordMinimizePending === false && !!data.recordMinimizedAt;
}

function diagnosticRows(id, data, includeResolved = false) {
  const rows = [];
  for (const kind of kinds) {
    const failure = data.jobFailures?.[kind];
    const active = activeJob(data, kind);
    const state = active && failure?.blocked === true ? "manual-intervention"
      : active && Number.isSafeInteger(failure?.attempts) && failure.attempts > 0 ? "retryable"
        : active && timestampMs(data[dueFields[kind]]) === null ? "unscheduled"
          : !active && resolvedJob(data, kind) ? "resolved"
            : !active && failure ? "inconsistent" : null;
    if (!state || state === "resolved" && !includeResolved) continue;
    rows.push({ applicationId: id, category: kind, state,
      attempts: Number.isSafeInteger(failure?.attempts) ? Math.max(0, Math.min(failure.attempts, 30)) : 0,
      lastFailureAt: timestampMs(failure?.lastAt) === null ? null : new Date(timestampMs(failure.lastAt)).toISOString(),
      code: safeCode(failure?.code) });
  }
  return rows;
}

function pageQuery(db, collectionName, batchSize, cursor) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("batchSize must be between 1 and 100.");
  }
  if (cursor !== undefined && !/^[A-Za-z0-9_-]{1,150}$/.test(cursor)) {
    throw new Error("Invalid checkpoint cursor.");
  }
  const query = db.collection(collectionName).orderBy(FieldPath.documentId());
  return (cursor ? query.startAfter(cursor) : query).limit(batchSize);
}

async function scanPage(db, collectionName, batchSize = 50, cursor, fields) {
  const query = pageQuery(db, collectionName, batchSize, cursor);
  const page = await (fields ? query.select(...fields) : query).get();
  return { documents: page.docs, scanned: page.size,
    nextCursor: page.size === batchSize ? page.docs.at(-1).id : null };
}

async function inspectPage(db, options = {}) {
  const page = await scanPage(db, "applications", options.batchSize, options.cursor, inspectionFields);
  return { scanned: page.scanned, nextCursor: page.nextCursor,
    rows: page.documents.flatMap((snapshot) =>
      diagnosticRows(snapshot.id, snapshot.data(), options.includeResolved === true)) };
}

function minimizationPlan(snapshot, days) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error("An explicitly approved 1-3650 day period is required.");
  const data = snapshot.data();
  if (!["approved", "declined"].includes(data.status)) return { reason: "not-terminal" };
  if (data.legalHold === true || data.appealOpen === true
      || data.legalHold?.status === "active" || data.appeal?.status === "open"
      || data.dispute?.status === "open") return { reason: "hold-or-appeal" };
  if (!data.noticeConfirmedAt?.toMillis?.()) return { reason: "notice-unconfirmed" };
  if (data.reviewNeedsReconcile === true) return { reason: "review-incomplete" };
  if (data.recordMinimizedAt || data.recordMinimizePending === true || data.recordMinimizeAt) {
    return { reason: "already-scheduled-or-minimized" };
  }
  if (data.documentCleanupPending !== false || (Array.isArray(data.documents) && data.documents.length)) {
    return { reason: "documents-not-purged" };
  }
  const purgedMs = timestampMs(data.documentsPurgedAt);
  if (purgedMs === null) return { reason: "missing-purge-time" };
  if (!Object.hasOwn(data, "fields")) return { reason: "no-raw-fields" };
  return { recordMinimizePending: true, recordMinimizeAtMs: purgedMs + days * dayMs };
}

async function planMinimizationPage(db, options) {
  const page = await scanPage(db, "applications", options.batchSize, options.cursor);
  const entries = page.documents.map((snapshot) => {
    const plan = minimizationPlan(snapshot, options.days);
    return { applicationId: snapshot.id,
      ...(plan.reason ? { action: "skip", reason: plan.reason } : {
        action: "schedule", changes: {
          recordMinimizePending: true, recordMinimizeAt: new Date(plan.recordMinimizeAtMs).toISOString()
        }
      }),
      snapshot };
  });
  return { scanned: page.scanned, nextCursor: page.nextCursor,
    entries, summary: { schedule: entries.filter((entry) => entry.action === "schedule").length,
      skip: entries.filter((entry) => entry.action === "skip").length } };
}

async function applyMinimizationPage(db, plan, days) {
  const results = [];
  let firstFailure = -1;
  for (let index = 0; index < plan.entries.length; index += 1) {
    const entry = plan.entries[index];
    if (entry.action !== "schedule") {
      results.push({ applicationId: entry.applicationId, outcome: "skipped", reason: entry.reason });
      continue;
    }
    try {
      const outcome = await db.runTransaction(async (transaction) => {
        const ref = db.doc(`applications/${entry.applicationId}`);
        const current = await transaction.get(ref);
        if (!current.exists || !current.updateTime.isEqual(entry.snapshot.updateTime)) return "stale-skip";
        const updatedPlan = minimizationPlan(current, days);
        if (updatedPlan.reason || updatedPlan.recordMinimizeAtMs !== Date.parse(entry.changes.recordMinimizeAt)) {
          return "stale-skip";
        }
        transaction.update(ref, {
          recordMinimizePending: true,
          recordMinimizeAt: Timestamp.fromMillis(updatedPlan.recordMinimizeAtMs)
        });
        return "scheduled";
      });
      results.push({ applicationId: entry.applicationId, outcome });
    } catch (error) {
      if (firstFailure === -1) firstFailure = index;
      results.push({ applicationId: entry.applicationId, outcome: "failed", code: safeCode(error?.code) });
    }
  }
  const nextCursor = firstFailure === -1 ? plan.nextCursor
    : firstFailure === 0 ? null : plan.entries[firstFailure - 1].applicationId;
  return { results, nextCursor, failures: results.filter((item) => item.outcome === "failed").length };
}

function legacyIssues(collectionName, snapshot) {
  if (!legacyCollections.has(collectionName)) throw new Error("Unsupported legacy collection.");
  const data = snapshot.data();
  const issues = [];
  if (["vendorApplications", "riderApplications"].includes(collectionName)) {
    issues.push("separate-legacy-application");
    if (data.status === "rejected") issues.push("legacy-rejected-status");
    if (!data.userId || !/^[A-Za-z0-9]{10,40}$/.test(snapshot.id)) issues.push("ownership-or-id-needs-review");
  }
  if (collectionName === "users" && data.role && !Array.isArray(data.roles)) issues.push("legacy-role-not-a-custom-claim");
  if (["vendors", "riders"].includes(collectionName) && (data.ownerId || data.userId) !== snapshot.id) {
    issues.push("partner-document-id-not-uid");
  }
  if (collectionName === "vendors" && data.businessName && !data.kitchenName) issues.push("legacy-business-name");
  if (collectionName === "menuItems") {
    if (data.available !== true && Object.hasOwn(data, "isAvailable")) issues.push("legacy-availability-field");
    if (data.imageUrl && !data.imagePath) issues.push("legacy-image-reference");
    if (!data.vendorOwnerId) issues.push("missing-vendor-owner");
  }
  return issues;
}

async function auditLegacyPage(db, collectionName, options = {}) {
  if (!legacyCollections.has(collectionName)) throw new Error("Unsupported legacy collection.");
  const page = await scanPage(db, collectionName, options.batchSize, options.cursor, legacyFields[collectionName]);
  return { collection: collectionName, scanned: page.scanned, nextCursor: page.nextCursor,
    rows: page.documents.map((snapshot) => ({ id: snapshot.id, issues: legacyIssues(collectionName, snapshot) }))
      .filter((item) => item.issues.length) };
}

module.exports = {
  diagnosticRows, inspectPage, minimizationPlan, planMinimizationPage,
  applyMinimizationPage, legacyIssues, auditLegacyPage
};
