const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { transformSync } = require("esbuild");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/firebase-client.js"), "utf8");
const code = transformSync(source, { format: "cjs", loader: "js" }).code;

async function marketplace(records) {
  const queries = [];
  const sdk = {
    initializeApp: () => ({}), getAuth: () => ({ currentUser: null }),
    getFirestore: () => ({}), getFunctions: () => ({}), getStorage: () => ({}),
    setPersistence: async () => {},
    onAuthStateChanged: (auth, callback) => { queueMicrotask(callback); return () => {}; },
    collection: (db, name) => name,
    where: (field, operator, value) => ({ field, operator, value }),
    limit: (max) => ({ max }), query: (name, ...constraints) => ({ name, constraints }),
    getDocs: async ({ name, constraints }) => {
      queries.push({ name, constraints });
      const rows = records[name].filter((row) => constraints.every((constraint) => (
        !constraint.field || row[constraint.field] === constraint.value
      ))).slice(0, constraints.find((constraint) => constraint.max).max);
      return { docs: rows.map(({ id, ...data }) => ({ id, data: () => data })) };
    }
  };
  const window = { dispatchEvent() {}, __MAMA_MEALS_FIREBASE_CONFIG__: { firebase: {
    apiKey: "demo", authDomain: "demo.invalid", projectId: "demo-marketplace",
    storageBucket: "demo.invalid", appId: "demo"
  } } };
  vm.runInNewContext(code, {
    window, require: (name) => { assert.match(name, /^firebase\//); return sdk; },
    localStorage: { length: 0 }, sessionStorage: { removeItem() {} },
    CustomEvent: class {}, queueMicrotask
  });
  await window.mamaMealsFirebase.ready;
  const result = await window.mamaMealsFirebase.loadMarketplace();
  return { result: JSON.parse(JSON.stringify(result)), queries };
}

const vendor = { id: "approved-owner", ownerId: "approved-owner", status: "approved",
  kitchenName: "Test Kilimani Kitchen", acceptingOrders: true };
const item = { id: "menu-pilau", vendorOwnerId: vendor.id, name: "Chicken Pilau",
  price: 450, imageUrl: "https://example.invalid/food.jpg", available: true, category: "Main Meals" };

test("marketplace joins published menu items to the approved kitchen without changing ownership", async () => {
  const { result, queries } = await marketplace({ vendors: [vendor], menuItems: [item] });
  assert.equal(result.length, 1);
  assert.equal(result[0].kitchenName, vendor.kitchenName);
  assert.deepEqual(result[0].items, [item]);
  assert.deepEqual(queries.map(({ name, constraints }) => [name, constraints[0].field]),
    [["menuItems", "available"], ["vendors", "status"]]);
  assert.ok(queries.every(({ constraints }) => constraints.some(({ max }) => max === 100)));
});

test("marketplace excludes unavailable, ownerless, unapproved and malformed items", async () => {
  const { result } = await marketplace({
    vendors: [vendor, { id: "pending-owner", ownerId: "pending-owner", status: "pending" },
      { id: "forged-owner", ownerId: vendor.id, status: "approved" }],
    menuItems: [item, { ...item, id: "hidden", available: false },
      ...["pending-owner", "missing-owner", "forged-owner", ""].map((owner) => (
        { ...item, id: owner || "no-owner", vendorOwnerId: owner }
      )), ...[0, -1, "not-a-price"].map((price) => ({ ...item, id: String(price), price })),
      { ...item, id: "no-photo", imageUrl: "" }, { ...item, id: "no-name", name: "" }]
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].items.map(({ id }) => id), [item.id]);
});

test("marketplace retains a legacy public business name until the vendor saves a kitchen name", async () => {
  const { result } = await marketplace({
    vendors: [{ ...vendor, kitchenName: "", businessName: "Legacy Kitchen" }], menuItems: [item]
  });
  assert.equal(result[0].kitchenName, "Legacy Kitchen");
});
