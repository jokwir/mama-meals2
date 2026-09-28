const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createMaintenanceHandler, maintenanceInvoker } = require("../functions/maintenance-http");
const { cleanupAbandonedApplications } = require("../functions/index.js");

function response() {
  return {
    code: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.code = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

test("maintenance endpoint is private, bounded and not an automatic regional schedule", () => {
  const endpoint = cleanupAbandonedApplications.__endpoint;
  assert.deepEqual(endpoint.httpsTrigger.invoker, ["private"]);
  assert.equal(endpoint.scheduleTrigger, undefined);
  assert.equal(endpoint.maxInstances, 1);
  assert.equal(endpoint.concurrency, 1);
  assert.equal(endpoint.timeoutSeconds, 120);
});

test("maintenance invoker defaults private and only accepts the dedicated scheduler identity", () => {
  const email = "mamameals-scheduler-invoker@mamameal-8946b.iam.gserviceaccount.com";
  assert.equal(maintenanceInvoker({}), "private");
  assert.equal(maintenanceInvoker({ APPLICATION_MAINTENANCE_INVOKER_EMAIL: email }), email);
  for (const invalid of ["public", "allUsers", "admin@example.com", "other@mamameal-8946b.iam.gserviceaccount.com"]) {
    assert.throws(() => maintenanceInvoker({ APPLICATION_MAINTENANCE_INVOKER_EMAIL: invalid }));
  }
});

test("maintenance HTTP boundary rejects reads and data-bearing requests without work", async () => {
  let runs = 0;
  const handle = createMaintenanceHandler(async () => { runs += 1; });
  const get = response();
  await handle({ method: "GET" }, get);
  assert.equal(get.code, 405);
  assert.equal(get.headers.Allow, "POST");
  const body = response();
  await handle({ method: "POST", body: { applicationId: "private" } }, body);
  assert.equal(body.code, 400);
  const rawBody = response();
  await handle({ method: "POST", rawBody: Buffer.from("{}"), body: {} }, rawBody);
  assert.equal(rawBody.code, 400);
  assert.equal(runs, 0);
});

test("maintenance HTTP boundary reports successful work and retryable failure without details", async () => {
  let runs = 0;
  const handle = createMaintenanceHandler(async () => {
    runs += 1;
    if (runs === 1) throw new Error("private applicant detail");
  });
  const failed = response();
  await handle({ method: "POST" }, failed);
  assert.equal(failed.code, 500);
  assert.equal(String(failed.body).includes("private applicant detail"), false);
  const succeeded = response();
  await handle({ method: "POST", body: "" }, succeeded);
  assert.equal(succeeded.code, 204);
  const scheduler = response();
  await handle({ method: "POST", rawBody: Buffer.alloc(0), body: {} }, scheduler);
  assert.equal(scheduler.code, 204);
  const parsedScheduler = response();
  await handle({ method: "POST", body: {} }, parsedScheduler);
  assert.equal(parsedScheduler.code, 204);
  assert.equal(runs, 4);
});
