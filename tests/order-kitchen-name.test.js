const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { transformSync } = require("esbuild");
const root = path.resolve(__dirname, "..");
const code = transformSync(fs.readFileSync(path.join(root, "assets/js/firebase-client.js"), "utf8"), { format: "cjs" }).code;
const app = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
const ui = app.slice(app.indexOf("async function updateTrackingKitchenName("), app.indexOf("function getCartTotals("));
const vendor = { ownerId: "vendor-one", status: "approved", kitchenName: "Customer 1 chef" };

async function client(record = vendor, fail = false) {
  const reads = [];
  const sdk = {
    initializeApp: () => ({}), getAuth: () => ({ currentUser: null }),
    getFirestore: () => ({}), getFunctions: () => ({}), getStorage: () => ({}),
    setPersistence: async () => {},
    onAuthStateChanged: (auth, callback) => { queueMicrotask(callback); return () => {}; },
    doc: (db, collection, id) => ({ collection, id }),
    getDoc: async (ref) => { reads.push(ref); if (fail) throw new Error("permission-denied");
      return { exists: () => Boolean(record), data: () => record }; }
  };
  const window = { dispatchEvent() {}, __MAMA_MEALS_FIREBASE_CONFIG__: { firebase: {
    apiKey: "demo", authDomain: "demo.invalid", projectId: "demo-kitchen",
    storageBucket: "demo.invalid", appId: "demo"
  } } };
  vm.runInNewContext(code, { window, require: () => sdk, localStorage: { length: 0 },
    sessionStorage: { removeItem() {} }, CustomEvent: class {}, queueMicrotask });
  const service = window.mamaMealsFirebase;
  await service.ready;
  service.state.user = { uid: "customer-one" };
  service.state.orders = [{ id: "TEST-ORDER", vendorOwnerId: "vendor-one",
    items: [{ name: "Misleading sample meal", image: "sample.png", vendorOwnerId: "wrong-vendor" }] }];
  return { service, reads };
}

test("tracking resolves the persisted vendor UID without matching dish names or images", async () => {
  const { service, reads } = await client();
  assert.equal(await service.loadOrderKitchenName("TEST-ORDER"), "Customer 1 chef");
  assert.deepEqual(reads, [{ collection: "vendors", id: "vendor-one" }]);
});

test("public legacy business names work even without active menu items", async () => {
  const { service } = await client({ ...vendor, kitchenName: "  ", businessName: " Legacy Kitchen " });
  assert.equal(await service.loadOrderKitchenName("TEST-ORDER"), "Legacy Kitchen");
});

test("missing, mismatched, unapproved and nameless profiles do not fabricate a kitchen", async () => {
  for (const record of [null, { ...vendor, ownerId: "someone-else" },
    { ...vendor, status: "suspended" }, { ...vendor, kitchenName: null }]) {
    const { service } = await client(record);
    assert.equal(await service.loadOrderKitchenName("TEST-ORDER"), null);
  }
});

test("unloaded orders, malformed owners and signed-out users cause no vendor reads", async () => {
  const { service, reads } = await client();
  assert.equal(await service.loadOrderKitchenName("OTHER-ORDER"), null);
  for (const owner of [undefined, "", "other/path", "x".repeat(129)]) {
    service.state.orders[0].vendorOwnerId = owner;
    assert.equal(await service.loadOrderKitchenName("TEST-ORDER"), null);
  }
  service.state.user = null;
  await assert.rejects(service.loadOrderKitchenName("TEST-ORDER"), /Sign in/);
  assert.equal(reads.length, 0);
});

function screen(load) {
  const target = { dataset: {}, isConnected: true, textContent: "" };
  const context = vm.createContext({ document: { querySelector: () => target },
    currentUser: "customer-one", getFirebaseBackend: () => ({ loadOrderKitchenName: load }) });
  vm.runInContext("function getActiveProfile() { return {userId: currentUser}; }\n" + ui, context);
  return { target, context, update: context.updateTrackingKitchenName };
}

test("kitchen names render as text, not HTML", async () => {
  const name = '<img src=x onerror="alert(1)">';
  const { target, update } = screen(async () => name);
  await update({ id: "TEST-ORDER" });
  assert.equal(target.textContent, name);
  assert.equal(target.innerHTML, undefined);
  assert.ok(app.includes("void updateTrackingKitchenName(order)"));
});

test("failed vendor reads leave tracking usable with an honest fallback", async () => {
  const { service } = await client(vendor, true);
  const { target, update } = screen((id) => service.loadOrderKitchenName(id));
  await update({ id: "TEST-ORDER" });
  assert.equal(target.textContent, "Kitchen unavailable");
});

test("a delayed result cannot replace a different order's kitchen", async () => {
  let finish;
  const { target, update } = screen((id) => id === "OLD"
    ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve("New Kitchen"));
  const old = update({ id: "OLD" });
  await update({ id: "NEW" });
  finish("Old Kitchen");
  await old;
  assert.equal(target.textContent, "New Kitchen");
});

test("a delayed result is ignored after account change or page removal", async () => {
  for (const detached of [false, true]) {
    let finish;
    const { target, context, update } = screen(() => new Promise((resolve) => { finish = resolve; }));
    const pending = update({ id: "TEST-ORDER" });
    if (detached) target.isConnected = false;
    else context.currentUser = "someone-else";
    finish("Prior account result");
    await pending;
    assert.notEqual(target.textContent, "Prior account result");
  }
});
