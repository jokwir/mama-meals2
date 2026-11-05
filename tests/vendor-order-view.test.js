const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/app.js"), "utf8");
function extract(name, nextName) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${nextName}(`));
}
const context = vm.createContext({ formatShillings: (value) => `KSh ${Number(value)}` });
vm.runInContext(extract("escapeHtml", "getShopMenuItems") +
  extract("renderVendorOrderCard", "initVendorDashboardPhase"), context);
const render = context.renderVendorOrderCard;
const order = {
  id: "TEST-ORDER", vendorOwnerId: "vendor-one", status: "Preparing Your Meal",
  items: [{ name: "Pilau", quantity: 1, price: 500 }], subtotal: 500,
  deliveryFee: 30, total: 530, paymentMethod: "Cash on Delivery",
  notes: "Controlled test only"
};

test("vendor details stay in the workspace and show the persisted order breakdown", () => {
  const html = render(order, "vendor-one");
  for (const text of ["<details", "<summary>View order details</summary>", "Pilau x 1",
    "Subtotal: KSh 500", "Delivery fee: KSh 30", "Total: KSh 530",
    "Cash on Delivery", "Controlled test only"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /href=|order-tracking|order-history/);
  assert.ok(source.includes("renderVendorOrderCard(order, account.userId)"));
});

test("renderer refuses missing or different vendor ownership", () => {
  assert.equal(render(order, "vendor-two"), "");
  assert.equal(render(order, ""), "");
  assert.equal(render({ ...order, vendorOwnerId: undefined }, undefined), "");
});

test("received orders keep the existing preparation action; later states cannot repeat it", () => {
  assert.match(render({ ...order, status: "Order Received - Preparing Soon" }, "vendor-one"),
    /data-vendor-order-action="preparing" data-order-id="TEST-ORDER"/);
  for (const status of ["Preparing Your Meal", "Out for Delivery", "Delivered", "Cancelled"]) {
    assert.doesNotMatch(render({ ...order, status }, "vendor-one"), /data-vendor-order-action/);
  }
});

test("order text and identifiers are escaped, never interpreted as markup", () => {
  const hostile = '<script>alert("x")</script>';
  const html = render({ ...order, id: hostile, notes: hostile, paymentMethod: hostile,
    items: [{ name: hostile, price: 500, quantity: 1 }] }, "vendor-one");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("optional legacy fields and zero delivery fee render without inventing values", () => {
  const html = render({ ...order, items: undefined, notes: "", paymentMethod: "", deliveryFee: 0 }, "vendor-one");
  assert.match(html, /Delivery fee: KSh 0/);
  assert.match(html, /Kitchen notes: None/);
  assert.match(html, /Payment method: Not recorded/);
});

test("vendor detail markup does not expose unrelated rider/contact or private document fields", () => {
  const html = render({ ...order, phone: "PRIVATE_PHONE", deliveryAddress: "PRIVATE_ADDRESS",
    documents: "PRIVATE_DOCUMENT" }, "vendor-one");
  assert.doesNotMatch(html, /PRIVATE_PHONE|PRIVATE_ADDRESS|PRIVATE_DOCUMENT/);
});
