const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { runtimeConfig } = require("./runtime-config");

const kinds = new Set(["expiry", "cleanup", "review", "retention", "minimization", "record-purge", "audit-access", "audit-claim", "audit-failure"]);

function errorCode(error) {
  return String(error?.code || "unknown").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50) || "unknown";
}

function archiveResolvedFailure(tx, db, applicationId, kind, failure, nowMs = Date.now()) {
  const failedAt = failure?.lastAt?.toMillis?.();
  if (!kinds.has(kind) || !Number.isFinite(failedAt)) return;
  const ref = db.doc(`applicationFailureHistory/${applicationId}-${kind}-${failedAt}`);
  tx.create(ref, {
    applicationId, category: kind,
    attempts: Number.isSafeInteger(failure.attempts) ? failure.attempts : 0,
    code: errorCode({ code: failure.code }),
    lastFailureAt: Timestamp.fromMillis(failedAt),
    resolvedAt: Timestamp.fromMillis(nowMs),
    auditNextAttemptAt: Timestamp.fromMillis(nowMs + 90 * 86400000)
  });
}

async function recordFailure(db, ref, kind, nextField, applies, error, nowMs = Date.now()) {
  if (!kinds.has(kind)) throw new Error("Unknown maintenance job kind.");
  const config = runtimeConfig();
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !applies(snapshot.data())) return null;
    const attempts = Math.min(config.maxJobAttempts, Number(snapshot.data().jobFailures?.[kind]?.attempts || 0) + 1);
    const blocked = attempts >= config.maxJobAttempts;
    const delay = Math.min(config.jobRetryMaxHours * 3600000,
      config.jobRetryBaseMinutes * 60000 * 2 ** (attempts - 1));
    transaction.update(ref, {
      [`jobFailures.${kind}`]: {
        attempts, blocked, code: errorCode(error), lastAt: Timestamp.fromMillis(nowMs)
      },
      [nextField]: blocked ? FieldValue.delete() : Timestamp.fromMillis(nowMs + delay)
    });
    return { attempts, blocked };
  });
  if (result && (result.attempts === 1 || result.blocked && result.attempts === config.maxJobAttempts)) {
    console.error("Application maintenance failure", {
      job: kind, applicationId: ref.id, code: errorCode(error),
      attempts: result.attempts, manualInterventionRequired: result.blocked
    });
  }
  return result;
}

async function processDuePages(query, handle, pageSize = 100) {
  const maxPages = runtimeConfig().jobPagesPerRun;
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const due = await (cursor ? query.startAfter(cursor) : query).limit(pageSize).get();
    for (const snapshot of due.docs) await handle(snapshot);
    if (due.size < pageSize) break;
    cursor = due.docs[due.docs.length - 1];
  }
}

module.exports = { recordFailure, processDuePages, archiveResolvedFailure };
