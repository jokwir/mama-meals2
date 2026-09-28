const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const { after, before, test } = require("node:test");

const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const callables = require("../functions/index.js");

let app;
let db;
const projectId = "demo-mama-meals-storage-rules";
const id = (prefix) => `${prefix}${randomUUID().replace(/-/g, "").slice(0, 20)}`;

before(() => {
  app = initializeApp({ projectId }, `marketplace-${process.pid}`);
  db = getFirestore(app);
});
after(async () => { await deleteApp(app); });

async function approvedVendor(acceptingOrders = true) {
  const uid = id("vendor");
  await db.doc(`vendors/${uid}`).set({ ownerId: uid, status: "approved", acceptingOrders });
  return uid;
}

async function menuItem(ownerId, available = true) {
  const itemId = id("Menu");
  await db.doc(`menuItems/${itemId}`).set({
    vendorOwnerId: ownerId, name: "Fresh pilau", description: "Freshly cooked pilau and vegetables",
    price: 425, category: "Main Meals", available,
    imageUrl: "https://example.invalid/public-menu-photo.jpg"
  });
  return itemId;
}

function orderRequest(items, customerId = id("customer")) {
  return { auth: { uid: customerId, token: { email_verified: true } }, data: { order: {
    deliveryAddress: "House 12, Nairobi Road, Kilimani", phone: "0700000000",
    paymentMethod: "Cash on Delivery", items
  } } };
}

test("forged cart name, price and vendor ID cannot change the trusted order", async () => {
  const owner = await approvedVendor();
  const forgedOwner = await approvedVendor();
  const itemId = await menuItem(owner);
  const result = await callables.createOrder.run(orderRequest([{
    menuItemId: itemId, name: "Forged name", price: 1, vendorOwnerId: forgedOwner, quantity: 2
  }]));
  assert.equal(result.vendorOwnerId, owner);
  assert.equal(result.items[0].name, "Fresh pilau");
  assert.equal(result.items[0].unitPrice, 425);
  assert.equal(result.subtotal, 850);
  assert.equal(result.total, 880);
  const stored = (await db.doc(`orders/${result.id}`).get()).data();
  assert.equal(stored.vendorOwnerId, owner);
  assert.equal(stored.items[0].vendorOwnerId, owner);

  await assert.rejects(callables.updateOrderStatus.run({
    auth: { uid: forgedOwner, token: { vendor: true, email_verified: true } },
    data: { orderId: result.id, action: "preparing" }
  }), /cannot perform/);
  await callables.updateOrderStatus.run({
    auth: { uid: owner, token: { vendor: true, email_verified: true } },
    data: { orderId: result.id, action: "preparing" }
  });
  assert.equal((await db.doc(`orders/${result.id}`).get()).data().status, "Preparing Your Meal");
});

test("mixed live vendors and live-plus-static carts are rejected", async () => {
  const first = await menuItem(await approvedVendor());
  const second = await menuItem(await approvedVendor());
  await assert.rejects(callables.createOrder.run(orderRequest([
    { menuItemId: first, quantity: 1 }, { menuItemId: second, quantity: 1 }
  ])), /separate orders/);
  await assert.rejects(callables.createOrder.run(orderRequest([
    { menuItemId: first, quantity: 1 }, { name: "Mukimo Plate", baseName: "Mukimo Plate", quantity: 1 }
  ])), /separate orders/);
});

test("unavailable items or kitchens not accepting orders cannot be checked out", async () => {
  const owner = await approvedVendor(false);
  const closedItem = await menuItem(owner);
  await assert.rejects(callables.createOrder.run(orderRequest([{ menuItemId: closedItem, quantity: 1 }])),
    /not accepting orders/);
  await db.doc(`vendors/${owner}`).update({ acceptingOrders: true });
  await db.doc(`menuItems/${closedItem}`).update({ available: false });
  await assert.rejects(callables.createOrder.run(orderRequest([{ menuItemId: closedItem, quantity: 1 }])),
    /no longer available/);
  await db.doc(`menuItems/${closedItem}`).update({ available: true });
  await db.doc(`vendors/${owner}`).update({ status: "suspended" });
  await assert.rejects(callables.createOrder.run(orderRequest([{ menuItemId: closedItem, quantity: 1 }])),
    /not accepting orders/);
});

test("customer or suspended vendor cannot publish or remove menu items", async () => {
  const suspended = await approvedVendor();
  await db.doc(`vendors/${suspended}`).update({ status: "suspended" });
  const menuId = id("Menu");
  await assert.rejects(callables.upsertVendorMenuItem.run({
    auth: { uid: id("customer"), token: { email_verified: true } },
    data: { item: { id: menuId } }
  }), /vendor access is required/);
  await assert.rejects(callables.upsertVendorMenuItem.run({
    auth: { uid: suspended, token: { vendor: true, email_verified: true } },
    data: { item: { id: menuId } }
  }), /approved vendor profile is required/);
  await assert.rejects(callables.deleteVendorMenuItem.run({
    auth: { uid: suspended, token: { vendor: true, email_verified: true } },
    data: { itemId: menuId }
  }), /approved vendor profile is required/);
});

test("a trusted vendor order can be accepted and delivered by an approved rider", async () => {
  const owner = await approvedVendor();
  const itemId = await menuItem(owner);
  const order = await callables.createOrder.run(orderRequest([{ menuItemId: itemId, quantity: 1 }]));
  const rider = id("rider");
  await db.doc(`riders/${rider}`).set({ ownerId: rider, status: "approved", available: true });
  const riderAuth = { uid: rider, token: { rider: true, email_verified: true } };
  for (const action of ["accept", "start", "delivered"]) {
    await callables.updateOrderStatus.run({ auth: riderAuth, data: { orderId: order.id, action } });
  }
  const stored = (await db.doc(`orders/${order.id}`).get()).data();
  assert.equal(stored.vendorOwnerId, owner);
  assert.equal(stored.assignedRiderId, rider);
  assert.equal(stored.status, "Delivered");
});
