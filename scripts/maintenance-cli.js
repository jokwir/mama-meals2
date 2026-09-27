const { createRequire } = require("node:module");
const {
  inspectPage, planMinimizationPage, applyMinimizationPage, auditLegacyPage
} = require("./maintenance-core");

const demoProject = "demo-mama-meals-storage-rules";
const productionProject = "mamameal-8946b";
const allowedCommands = new Set(["inspect", "backfill-record-minimization", "audit-legacy"]);
const allowedFlags = new Set([
  "emulator", "production-read", "production-write", "project", "batch-size", "cursor",
  "include-resolved", "collection", "days", "apply", "confirm-project", "confirm-schedules-deletion"
]);

function parseArgs(argv, environment = process.env) {
  const [command, ...tokens] = argv;
  if (!allowedCommands.has(command)) throw new Error("Use inspect, backfill-record-minimization, or audit-legacy.");
  const options = {};
  for (const token of tokens) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(token);
    if (!match || !allowedFlags.has(match[1]) || Object.hasOwn(options, match[1])) {
      throw new Error("Unknown, duplicate, or malformed option.");
    }
    options[match[1]] = match[2] === undefined ? true : match[2];
  }
  const booleanFlags = ["emulator", "production-read", "production-write", "include-resolved", "apply", "confirm-schedules-deletion"];
  if (booleanFlags.some((key) => options[key] !== undefined && options[key] !== true)) {
    throw new Error("Boolean switches do not take values.");
  }
  const emulator = options.emulator === true;
  const projectId = options.project || (emulator ? demoProject : undefined);
  if (emulator) {
    if (projectId !== demoProject || !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(environment.FIRESTORE_EMULATOR_HOST || "")) {
      throw new Error("Emulator mode requires the demo project and a local Firestore emulator host.");
    }
    if (options["production-read"] || options["production-write"]) throw new Error("Do not mix emulator and production switches.");
  } else if (projectId !== productionProject || options["production-read"] !== true) {
    throw new Error("Production access requires --production-read and the exact project ID.");
  } else if (environment.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Production mode must not use an emulator host.");
  }
  const batchSize = options["batch-size"] === undefined ? 50 : Number(options["batch-size"]);
  if (!/^[1-9][0-9]*$/.test(String(options["batch-size"] ?? 50))
      || !Number.isSafeInteger(batchSize) || batchSize > 100) throw new Error("Batch size must be 1-100.");
  const cursor = options.cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(cursor))) {
    throw new Error("Invalid checkpoint cursor.");
  }
  if (options.apply && command !== "backfill-record-minimization") throw new Error("Apply is only available for record-minimization backfill.");
  if (options.collection && command !== "audit-legacy") throw new Error("Collection is only valid for legacy audit.");
  if (options["include-resolved"] && command !== "inspect") throw new Error("Include-resolved is only valid for inspection.");
  if (command === "backfill-record-minimization") {
    const days = Number(options.days);
    if (options.days === undefined || !/^[1-9][0-9]*$/.test(String(options.days))
        || !Number.isSafeInteger(days) || days > 3650) {
      throw new Error("Backfill requires an explicit approved --days=1..3650; no value is chosen by the tool.");
    }
    if (options.apply && (options["confirm-project"] !== projectId || !options["confirm-schedules-deletion"])) {
      throw new Error("Writes require --confirm-project=<project> and --confirm-schedules-deletion.");
    }
    if (options.apply && !emulator && options["production-write"] !== true) {
      throw new Error("Production writes also require --production-write.");
    }
  } else if (options.days || options["confirm-project"] || options["confirm-schedules-deletion"] || options["production-write"]) {
    throw new Error("Write-related options are only valid for backfill.");
  }
  if (command === "audit-legacy" && !options.collection) throw new Error("Legacy audit requires --collection.");
  return { command, projectId, emulator, batchSize, cursor,
    includeResolved: options["include-resolved"] === true,
    collection: options.collection, days: options.days === undefined ? undefined : Number(options.days),
    apply: options.apply === true };
}

function publicPlan(plan) {
  return { scanned: plan.scanned, nextCursor: plan.nextCursor, summary: plan.summary,
    entries: plan.entries.map(({ applicationId, action, reason, changes }) =>
      ({ applicationId, action, ...(reason ? { reason } : { changes }) })) };
}

async function run(argv = process.argv.slice(2), environment = process.env) {
  const options = parseArgs(argv, environment);
  const functionsRequire = createRequire(require.resolve("../functions/package.json"));
  const { initializeApp, applicationDefault, deleteApp } = functionsRequire("firebase-admin/app");
  const { getFirestore } = functionsRequire("firebase-admin/firestore");
  const app = initializeApp(options.emulator
    ? { projectId: options.projectId }
    : { projectId: options.projectId, credential: applicationDefault() }, `maintenance-${process.pid}`);
  try {
    const db = getFirestore(app);
    if (options.command === "inspect") {
      console.log(JSON.stringify({ mode: "read-only", projectId: options.projectId,
        ...await inspectPage(db, options) }));
    } else if (options.command === "audit-legacy") {
      console.log(JSON.stringify({ mode: "read-only", projectId: options.projectId,
        ...await auditLegacyPage(db, options.collection, options) }));
    } else {
      const plan = await planMinimizationPage(db, options);
      console.log(JSON.stringify({ mode: options.apply ? "plan-before-write" : "dry-run",
        projectId: options.projectId, ...publicPlan(plan) }));
      if (options.apply) {
        const result = await applyMinimizationPage(db, plan, options.days);
        console.log(JSON.stringify({ mode: "apply-result", projectId: options.projectId, ...result }));
        if (result.failures) process.exitCode = 2;
      }
    }
  } finally {
    await deleteApp(app);
  }
}

if (require.main === module) {
  run().catch(() => {
    process.stderr.write("Maintenance command stopped safely. Check mode, project, emulator or credentials.\n");
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, publicPlan, run };
