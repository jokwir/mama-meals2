const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { test, before, after } = require("node:test");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/css/style.css"), "utf8");
const html = fs.readFileSync(path.join(root, "rider-dashboard.html"), "utf8")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<link\b[^>]*>/gi, "");
const init = app.slice(app.indexOf("function initRiderDashboardPhase("), app.indexOf("function initRoleDashboardPhase("));
const escape = app.slice(app.indexOf("function escapeHtml("), app.indexOf("function getShopMenuItems("));
const shots = fs.mkdtempSync(path.join(os.tmpdir(), "mama-rider-layout-"));
let browser;
before(async () => { browser = await chromium.launch({ channel: "msedge", headless: true }); });
after(async () => { await browser?.close(); console.log(`Layout screenshots: ${shots}`); });

async function fixture(width, route, allowed = true) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.route("**/*", (request) => request.request().isNavigationRequest()
    ? request.fulfill({ contentType: "text/html", body: html }) : request.abort());
  await page.goto(`https://rider-test.invalid/${route}`);
  await page.addStyleTag({ content: css });
  await page.evaluate(({ allowed }) => {
    window.profileCanAccess = () => allowed;
    window.renderAccessDenied = () => { document.querySelector("main").textContent = "Rider access required"; };
    window.getActiveProfile = () => ({ userId: "test-rider" });
    window.getStoredRiderProfile = () => ({ available: true, serviceArea: "Test area", vehicleType: "Bicycle", plate: "TEST" });
    window.getPartnerApplications = () => ({});
    window.getFirstName = () => "Test Rider";
    window.getSelectedLocation = () => "Test area";
    window.deliveryFee = 30;
    window.formatShillings = (v) => `KSh ${v}`;
    window.orders = [{ id: "TEST-20261104-001", assignedRiderId: "test-rider", status: "Preparing Your Meal",
      deliveryAddress: "Generated test address with a long building description and landmark, not a real delivery destination", deliveryFee: 30 },
    { id: "TEST-COMPLETED", assignedRiderId: "test-rider", status: "Delivered", deliveryAddress: "Generated address", deliveryFee: 30 },
    { id: "OTHER-RIDER-PRIVATE", assignedRiderId: "someone-else", status: "Preparing", deliveryAddress: "Not for this rider" }];
    window.getOrders = () => window.orders;
    window.getFirebaseState = () => ({ deliveryOffers: [{ id: "TEST-OFFER", deliveryFee: 30 }] });
    window.actions = [];
    window.getFirebaseBackend = () => ({ updateOrderStatus: async (id, action) => {
      window.actions.push({ id, action });
      const order = window.orders.find((item) => item.id === id);
      if (order) order.status = action === "start" ? "Out for Delivery" : "Delivered";
    } });
  }, { allowed });
  await page.addScriptTag({ content: escape + init + "\ninitRiderDashboardPhase();" });
  return page;
}

for (const width of [320, 390, 768, 1280]) {
  for (const route of ["rider-dashboard.html", "rider-dashboard"]) {
    test(`rider layout and local trip actions at ${width}px on ${route}`, async () => {
      const page = await fixture(width, route);
      try {
        assert.equal(await page.locator("#rider-active-list").count(), 1);
        const metrics = await page.evaluate(() => {
          const main = document.querySelector("main");
          const shell = main.querySelector(".dashboard-shell");
          const mainStyle = getComputedStyle(main);
          const row = document.querySelector("#rider-active-list .rider-delivery-item");
          const text = row.querySelector("div").getBoundingClientRect();
          const action = row.querySelector("button").getBoundingClientRect();
          return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
            inner: main.clientWidth - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight),
            shell: shell.getBoundingClientRect().width, text: text.width, textBottom: text.bottom,
            buttonTop: action.top, overflowing: [...shell.querySelectorAll("*")].filter((el) =>
              el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && !el.matches("input, select")).map((el) => el.tagName) };
        });
        assert.ok(metrics.shell >= metrics.inner - 2, JSON.stringify(metrics));
        assert.ok(metrics.pageWidth <= metrics.viewport + 1, JSON.stringify(metrics));
        assert.ok(metrics.text > 150, JSON.stringify(metrics));
        assert.ok(metrics.buttonTop >= metrics.textBottom, JSON.stringify(metrics));
        assert.deepEqual(metrics.overflowing, []);
        assert.ok(!(await page.locator("main").textContent()).includes("OTHER-RIDER-PRIVATE"));
        await page.screenshot({ path: path.join(shots, `${width}-${route}.png`), fullPage: true });
        await page.locator('[data-rider-order-action="start"]').click();
        await page.locator('[data-rider-order-action="complete"]').click();
        assert.deepEqual(await page.evaluate(() => window.actions), [
          { id: "TEST-20261104-001", action: "start" }, { id: "TEST-20261104-001", action: "delivered" }
        ]);
        assert.match(await page.locator("#rider-active-list").textContent(), /No active trips/);
      } finally { await page.close(); }
    });
  }
}

test("extensionless rider route still denies users without the rider role", async () => {
  const page = await fixture(390, "rider-dashboard", false);
  try {
    assert.equal(await page.locator("main").textContent(), "Rider access required");
    assert.equal(await page.locator("#rider-profile-form").count(), 0);
  } finally { await page.close(); }
});
