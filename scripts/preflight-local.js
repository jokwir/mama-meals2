const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

const root = path.resolve(__dirname, "..");
if (process.argv.includes("--production-config")) {
  for (const relativePath of [".env.local", "functions/.env.local"]) {
    const localConfig = path.join(root, relativePath);
    if (fs.existsSync(localConfig)) process.loadEnvFile(localConfig);
  }
}
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const firebase = JSON.parse(read("firebase.json"));
const indexes = JSON.parse(read("firebase/firestore.indexes.json"));
const storageRules = read("firebase/storage.rules");
const firestoreRules = read("firebase/firestore.rules");
const netlify = read("netlify.toml");

assert.equal(firebase.functions.source, "functions");
assert.equal(firebase.functions.runtime, "nodejs22");
assert.equal(JSON.parse(read("functions/package.json")).engines.node, "22");
assert.equal(firebase.firestore.rules, "firebase/firestore.rules");
assert.equal(firebase.firestore.indexes, "firebase/firestore.indexes.json");
assert.equal(firebase.storage.rules, "firebase/storage.rules");
assert.equal(firebase.hosting.public, "dist");
for (const name of [firebase.firestore.rules, firebase.firestore.indexes, firebase.storage.rules]) {
  assert.ok(fs.existsSync(path.join(root, name)), `${name} is missing`);
}
assert.match(storageRules, /match \/applications\/\{userId\}\/\{applicationId\}\/\{type\}\/\{field\}\s*\{\s*allow read, write: if false;/);
assert.match(firestoreRules, /match \/applications\/\{applicationId\}[\s\S]*?allow create, update, delete: if false;/);
assert.match(netlify, /command\s*=\s*"npm run build"/);
assert.match(netlify, /publish\s*=\s*"dist"/);

const requiredIndexes = [
  ["status", "expiryNextAttemptAt"],
  ["cleanupPending", "finalCleanupAfter"],
  ["reviewNeedsReconcile", "reviewNextAttemptAt"],
  ["documentCleanupPending", "documentNextAttemptAt"],
  ["recordMinimizePending", "recordMinimizeAt"],
  ["status", "pendingReviewAlertAt"]
];
for (const fields of requiredIndexes) {
  assert.ok(indexes.indexes.some((entry) => entry.collectionGroup === "applications"
    && entry.fields.map((field) => field.fieldPath).join(",") === fields.join(",")),
  `Missing applications index: ${fields.join(" + ")}`);
}

const retentionWorkflow = require("../functions/retention-workflow");
const { runtimeConfig } = require("../functions/runtime-config");
const runtime = runtimeConfig(process.env);
const retention = retentionWorkflow.configuredRetentionDays(process.env);
const minimizeDays = retentionWorkflow.configuredRecordMinimizationDays(process.env);
if (process.argv.includes("--production-config")) {
  assert.deepEqual(retentionWorkflow.missingRetentionClasses(retention), [],
    "Identity, food-safety, application food-photo, and vehicle retention must be configured for both decisions");
  const expectedProject = "mamameal-8946b";
  const expectedBucket = `${expectedProject}.firebasestorage.app`;
  const required = ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID",
    "FIREBASE_STORAGE_BUCKET", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID"];
  const missing = required.filter((key) => !process.env[key] || /replace|example|your-/i.test(process.env[key]));
  assert.deepEqual(missing, [], `Missing or placeholder public Firebase variables: ${missing.join(", ")}`);
  assert.equal(process.env.FIREBASE_PROJECT_ID, expectedProject, "Unexpected Firebase project ID");
  assert.equal(process.env.FIREBASE_AUTH_DOMAIN, `${expectedProject}.firebaseapp.com`, "Unexpected Firebase Auth domain");
  assert.equal(process.env.FIREBASE_STORAGE_BUCKET, expectedBucket, "Unexpected Firebase Storage bucket");
  assert.ok(["europe-west1", "africa-south1"].includes(runtime.region), "Unexpected Functions region");
  const functionsEnvPath = path.join(root, "functions", `.env.${expectedProject}`);
  assert.ok(fs.existsSync(functionsEnvPath), "Missing project-scoped Functions deployment environment");
  const deployEnv = parseEnv(fs.readFileSync(functionsEnvPath, "utf8"));
  assert.deepEqual(Object.keys(deployEnv).filter((key) => /^(FIREBASE_|X_GOOGLE_|EXT_|KIT_)/.test(key)), [],
    "Functions deployment environment contains a Firebase-reserved key");
  assert.equal(deployEnv.APPLICATION_FUNCTIONS_REGION, runtime.region,
    "Functions deployment and web build regions do not match");
  assert.equal(deployEnv.APPLICATION_MAINTENANCE_INVOKER_EMAIL,
    `mamameals-scheduler-invoker@${expectedProject}.iam.gserviceaccount.com`,
    "Functions deployment must preserve the dedicated Scheduler invoker");
  const deployRetention = retentionWorkflow.configuredRetentionDays(deployEnv);
  assert.deepEqual(retentionWorkflow.missingRetentionClasses(deployRetention), [],
    "Functions deployment environment is missing document retention classes");
  assert.deepEqual(deployRetention, retention, "Functions deployment retention differs from approved local policy");
}

console.log(`Local release preflight OK (no cloud calls; Functions ${runtime.region}; retention ${Object.keys(retention).length ? "configured" : "disabled"}; record minimization ${minimizeDays === undefined ? "disabled" : "configured"}).`);
