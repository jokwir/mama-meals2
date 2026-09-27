const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const { after, before, test } = require("node:test");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
const { getFirestore, Timestamp } = functionsRequire("firebase-admin/firestore");
const core = require("../scripts/maintenance-core");
const { parseArgs, publicPlan } = require("../scripts/maintenance-cli");
const retention = require("../functions/retention-workflow");
const workflow = require("../functions/application-workflow");
const callables = require("../functions/index.js");

let app;
let db;
const demo = "demo-mama-meals-storage-rules";
function id(prefix) { return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 18)}`; }

before(() => {
  app = initializeApp({ projectId: demo }, `maintenance-${process.pid}`);
  db = getFirestore(app);
});
after(async () => { await deleteApp(app); });

test("CLI requires explicit local or production mode and double-confirmation for writes", () => {
  assert.throws(() => parseArgs(["inspect"], {}), /Production access requires/);
  assert.throws(() => parseArgs(["inspect", "--emulator"], {}), /local Firestore emulator/);
  assert.throws(() => parseArgs(["inspect", "--production-read", "--project=other"], {}), /exact project ID/);
  assert.throws(() => parseArgs(["inspect", "--production-read", "--project=mamameal-8946b"],
    { FIRESTORE_EMULATOR_HOST: "127.0.0.1:18080" }), /must not use an emulator/);
  const env = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:18080" };
  assert.throws(() => parseArgs(["backfill-record-minimization", "--emulator"], env), /explicit approved/);
  assert.throws(() => parseArgs(["backfill-record-minimization", "--emulator", "--days=1", "--apply"], env), /confirm-project/);
  assert.throws(() => parseArgs(["inspect", "--emulator", "--batch-size=101"], env), /Batch size/);
  assert.throws(() => parseArgs(["inspect", "--emulator", "--cursor=../wrong"], env), /cursor/);
  const dry = parseArgs(["backfill-record-minimization", "--emulator", "--days=1"], env);
  assert.equal(dry.apply, false);
  const write = parseArgs(["backfill-record-minimization", "--emulator", "--days=1", "--apply",
    `--confirm-project=${demo}`, "--confirm-schedules-deletion"], env);
  assert.equal(write.apply, true);
});

test("inspection is paged and redacts private fields, tokens and arbitrary error strings", async () => {
  const first = id("InspectA");
  const second = id("InspectZ");
  await db.doc(`applications/${first}`).set({ status: "cancelled", cleanupPending: true,
    fields: { fullName: "DO-NOT-PRINT", identityDocument: "PRIVATE-TOKEN" },
    jobFailures: { cleanup: { attempts: 2, blocked: false,
      lastAt: Timestamp.fromMillis(1000), code: "DO-NOT-PRINT" } } });
  await db.doc(`applications/${second}`).set({ status: "approved", reviewNeedsReconcile: true,
    jobFailures: { review: { attempts: 8, blocked: true,
      lastAt: Timestamp.fromMillis(2000), code: "unavailable" } } });
  const firstRows = core.diagnosticRows(first, (await db.doc(`applications/${first}`).get()).data());
  assert.deepEqual(firstRows.map((row) => row.state), ["retryable"]);
  assert.equal(firstRows[0].code, "unknown");
  const secondRows = core.diagnosticRows(second, (await db.doc(`applications/${second}`).get()).data());
  assert.deepEqual(secondRows.map((row) => row.state), ["manual-intervention"]);
  assert.equal(secondRows[0].attempts, 8);
  assert.equal(JSON.stringify([...firstRows, ...secondRows]).includes("DO-NOT-PRINT"), false);
  assert.equal(JSON.stringify([...firstRows, ...secondRows]).includes("PRIVATE-TOKEN"), false);
  const resolved = core.diagnosticRows(id("Resolved"), {
    status: "approved", documentCleanupPending: false, documentsPurgedAt: Timestamp.now()
  }, true);
  assert.equal(resolved[0].state, "resolved");
  assert.equal(core.diagnosticRows(id("Unscheduled"), { status: "cancelled", cleanupPending: true })[0].state, "unscheduled");
  assert.equal(core.diagnosticRows(id("Inconsistent"), { status: "pending",
    jobFailures: { cleanup: { attempts: 3, blocked: true, code: "unavailable" } } })[0].state, "inconsistent");
  const page = await core.inspectPage(db, { batchSize: 1 });
  assert.equal(page.scanned, 1);
  assert.ok(page.nextCursor);
  assert.equal((await core.inspectPage(db, { batchSize: 1, cursor: page.nextCursor })).scanned, 1);
});

test("backfill dry-run, stale-snapshot guard and replay are non-destructive", async () => {
  const target = id("BackfillTarget");
  const stale = id("BackfillStale");
  const held = id("BackfillHeld");
  const purgedAt = Timestamp.fromMillis(Date.now() - 2 * 86400000);
  for (const applicationId of [target, stale, held]) {
    await db.doc(`applications/${applicationId}`).set({
      userId: id("owner"), type: "cook", status: "approved", fields: { fullName: "DO-NOT-PRINT" },
      documentCleanupPending: false, documentsPurgedAt: purgedAt, noticeConfirmedAt: purgedAt,
      ...(applicationId === held ? { legalHold: true } : {})
    });
  }
  const targetSnapshot = await db.doc(`applications/${target}`).get();
  const staleSnapshot = await db.doc(`applications/${stale}`).get();
  const heldSnapshot = await db.doc(`applications/${held}`).get();
  const entries = [targetSnapshot, staleSnapshot, heldSnapshot].map((snapshot) => {
    const proposed = core.minimizationPlan(snapshot, 1);
    return { applicationId: snapshot.id, snapshot,
      ...(proposed.reason ? { action: "skip", reason: proposed.reason } : {
        action: "schedule", changes: { recordMinimizePending: true,
          recordMinimizeAt: new Date(proposed.recordMinimizeAtMs).toISOString() }
      }) };
  });
  const plan = { entries, scanned: 3, nextCursor: held, summary: { schedule: 2, skip: 1 } };
  assert.equal(JSON.stringify(publicPlan(plan)).includes("DO-NOT-PRINT"), false);
  assert.equal((await db.doc(`applications/${target}`).get()).data().recordMinimizePending, undefined);
  await db.doc(`applications/${stale}`).update({ appealOpen: true });
  const result = await core.applyMinimizationPage(db, plan, 1);
  assert.equal(result.failures, 0);
  assert.equal(result.results.find((row) => row.applicationId === target).outcome, "scheduled");
  assert.equal(result.results.find((row) => row.applicationId === stale).outcome, "stale-skip");
  assert.equal((await db.doc(`applications/${held}`).get()).data().recordMinimizePending, undefined);
  assert.equal((await db.doc(`applications/${stale}`).get()).data().recordMinimizePending, undefined);
  const after = (await db.doc(`applications/${target}`).get()).data();
  assert.equal(after.recordMinimizePending, true);
  assert.equal(after.fields.fullName, "DO-NOT-PRINT");
  assert.equal((await core.applyMinimizationPage(db, plan, 1)).results[0].outcome, "stale-skip");
});

test("partial backfill failure keeps a resumable checkpoint before the failed record", async () => {
  const first = id("PartialFirst");
  const second = id("PartialSecond");
  const purged = Timestamp.fromMillis(Date.now() - 86400000);
  const entries = [];
  for (const applicationId of [first, second]) {
    const ref = db.doc(`applications/${applicationId}`);
    await ref.set({ userId: id("owner"), type: "rider", status: "declined", fields: {},
      documentCleanupPending: false, documentsPurgedAt: purged, noticeConfirmedAt: purged });
    const snapshot = await ref.get();
    entries.push({ applicationId, snapshot, action: "schedule",
      changes: { recordMinimizePending: true, recordMinimizeAt: new Date(purged.toMillis() + 86400000).toISOString() } });
  }
  let calls = 0;
  const wrapped = {
    doc: db.doc.bind(db),
    runTransaction: (action) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("transient"), { code: "unavailable" });
      return db.runTransaction(action);
    }
  };
  const result = await core.applyMinimizationPage(wrapped, { entries, nextCursor: second }, 1);
  assert.equal(result.failures, 1);
  assert.equal(result.nextCursor, first);
  assert.equal((await db.doc(`applications/${first}`).get()).data().recordMinimizePending, true);
  assert.equal((await db.doc(`applications/${second}`).get()).data().recordMinimizePending, undefined);
  const replay = await core.applyMinimizationPage(db, { entries, nextCursor: second }, 1);
  assert.deepEqual(replay.results.map((item) => item.outcome), ["stale-skip", "scheduled"]);
});

test("legacy audit reports schema mismatches without exposing personal values", async () => {
  const legacyId = id("LegacyApp");
  const ref = db.doc(`vendorApplications/${legacyId}`);
  await ref.set({ userId: "legacy-owner", status: "rejected", phone: "DO-NOT-PRINT" });
  const page = await core.auditLegacyPage(db, "vendorApplications", { batchSize: 100 });
  const row = page.rows.find((item) => item.id === legacyId);
  assert.ok(row.issues.includes("separate-legacy-application"));
  assert.ok(row.issues.includes("legacy-rejected-status"));
  assert.equal(JSON.stringify(row).includes("DO-NOT-PRINT"), false);
  assert.throws(() => core.legacyIssues("applications", { data: () => ({}) }), /Unsupported/);
  const menu = { id: id("LegacyMenu"), data: () => ({ isAvailable: false, imageUrl: "DO-NOT-PRINT" }) };
  assert.deepEqual(core.legacyIssues("menuItems", menu),
    ["legacy-availability-field", "legacy-image-reference", "missing-vendor-owner"]);
});

test("a stale cursor resumes after deletion and a final sweep finds earlier inserts", async () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const first = `CursorA${suffix}`;
  const inserted = `CursorB${suffix}`;
  const last = `CursorC${suffix}`;
  for (const applicationId of [first, last]) {
    await db.doc(`riderApplications/${applicationId}`).set({ userId: "test-owner", status: "pending" });
  }
  await db.doc(`riderApplications/${first}`).delete();
  const resumed = await core.auditLegacyPage(db, "riderApplications", { batchSize: 1, cursor: first });
  assert.equal(resumed.rows[0].id, last);
  await db.doc(`riderApplications/${inserted}`).set({ userId: "test-owner", status: "pending" });
  const afterLast = await core.auditLegacyPage(db, "riderApplications", { batchSize: 1, cursor: last });
  assert.equal(afterLast.rows.some((row) => row.id === inserted), false);
  const finalSweep = await core.auditLegacyPage(db, "riderApplications", { batchSize: 100 });
  assert.equal(finalSweep.rows.some((row) => row.id === inserted), true);
});

test("legacy unavailable menu items cannot be ordered despite old isAvailable shape", async () => {
  const menuItemId = id("LegacyMenu");
  await db.doc(`menuItems/${menuItemId}`).set({ name: "Old dish", price: 100,
    isAvailable: false, vendorOwnerId: "old-vendor" });
  await assert.rejects(callables.createOrder.run({
    auth: { uid: id("customer"), token: { email_verified: true } },
    data: { order: { deliveryAddress: "House 12, Nairobi Road", phone: "0700000000",
      items: [{ menuItemId, quantity: 1 }], paymentMethod: "Cash on Delivery" } }
  }), /no longer available/);
});

test("Storage deletion followed by failed Firestore commit safely retries exact generation", async () => {
  const applicationId = id("RetainRetry");
  const owner = id("owner");
  const path = workflow.objectPath(owner, applicationId, "rider", "identityPhoto");
  const ref = db.doc(`applications/${applicationId}`);
  await ref.set({ userId: owner, type: "rider", status: "declined",
    documents: [{ field: "identityPhoto", path, generation: "7" }],
    noticeConfirmedAt: Timestamp.fromMillis(Date.now() - 20 * 86400000),
    documentCleanupPending: true, documentsPurgeAt: Timestamp.fromMillis(Date.now() - 1000) });
  const objects = new Set([`${path}@7`]);
  const bucket = { file(name, options) { return { async delete() { objects.delete(`${name}@${options.generation}`); } }; } };
  let transactionCount = 0;
  const interruptedDb = { doc: db.doc.bind(db), runTransaction: async (action) => {
    transactionCount += 1;
    if (transactionCount === 2) throw new Error("Firestore unavailable after Storage deletion");
    return db.runTransaction(action);
  } };
  await assert.rejects(retention.purgeSubmittedFiles(interruptedDb, bucket, applicationId), /Firestore unavailable/);
  assert.equal(objects.size, 0);
  assert.equal((await ref.get()).data().documentCleanupPending, true);
  assert.equal(await retention.purgeSubmittedFiles(db, bucket, applicationId), true);
  assert.equal((await ref.get()).data().documentCleanupPending, false);
});
