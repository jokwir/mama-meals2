const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createMaintenanceHandler } = require("../functions/maintenance-http");
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
  assert.equal(runs, 2);
});
