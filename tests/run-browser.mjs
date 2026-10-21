import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { demoConfig, demoProducts } from "./helpers.mjs";
import { createStaticServer } from "./server.mjs";

const server = createStaticServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const baseURL = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
let orderPayload;

function workerResponse(route, body, status = 200) {
  return route.fulfill({
    status,
    json: body,
    headers: { "Access-Control-Allow-Origin": baseURL }
  });
}

async function configureStorePage(page) {
  await page.route("**/data/products.json", (route) => route.fulfill({ json: demoProducts }));
  await page.route("**/data/config.json", (route) => route.fulfill({ json: demoConfig }));
  await page.route("https://example.test/**", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'></svg>"
  }));
  await page.route("https://worker.test/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": baseURL,
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type"
        }
      });
    }
    if (new URL(route.request().url()).pathname === "/orders") {
      orderPayload = route.request().postDataJSON();
      return workerResponse(route, { ok: true, orderId: "order-id" });
    }
    return workerResponse(route, {});
  });
  page.on("pageerror", (error) => failures.push(error.message));
}

async function testStorefront() {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("storefront page error:", error));
  await configureStorePage(page);
  await page.goto(`${baseURL}/`, { waitUntil: "commit" });
  await page.waitForLoadState("domcontentloaded");
  try {
    await page.locator(".product-card").nth(demoProducts.length - 1).waitFor({ timeout: 10000 });
  } catch (error) {
    console.error("storefront state:", await page.evaluate(() => ({
      ready: document.readyState,
      status: document.querySelector("#products-status")?.textContent,
      cards: document.querySelectorAll(".product-card").length
    })));
    throw error;
  }
  assert.equal(await page.locator(".product-card").count(), demoProducts.length);

  await page.locator(".product-card").first().locator(".order-button").dispatchEvent("click");
  await page.waitForURL(/product\.html\?id=colored-item/);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() =>
    !document.querySelector("#product-detail").hidden ||
    document.querySelector("#product-status").classList.contains("error"),
    null,
    { timeout: 15000 }
  );
  if (await page.locator("#product-detail").isHidden()) {
    throw new Error(`Product page did not load: ${await page.locator("#product-status").textContent()}`);
  }
  assert.equal(await page.locator("#add-to-bag").isDisabled(), true);
  await page.locator("#color-options button").first().click();
  assert.equal(await page.locator("#add-to-bag").isDisabled(), false);
  await page.locator("#add-to-bag").click();
  await page.locator("#bag-button").dispatchEvent("click");
  assert.equal(await page.locator("#cart-items .cart-line").count(), 1);
  assert.ok((await page.locator("#cart-total").textContent()).includes("129"));
  await page.locator("#cart-items .cart-quantity-button").nth(1).click();
  assert.equal(await page.locator("#cart-items .cart-line-quantity").textContent(), "2");
  assert.ok((await page.locator("#cart-total").textContent()).includes("258"));
  await page.locator("#cart-items .cart-remove-button").click();
  assert.equal(await page.locator("#cart-items .cart-line").count(), 0);
  await page.locator("#close-checkout").dispatchEvent("click");

  await page.locator("#add-to-bag").click();
  await page.locator("#bag-button").dispatchEvent("click");
  await page.locator("#customer-name").fill("أمين");
  await page.locator("#customer-phone").fill("06 123 456 78");
  await page.locator("#customer-city").fill("الرباط، حي حسان");
  await page.locator("#checkout-form").dispatchEvent("submit");
  await page.waitForFunction(() => document.querySelector("#checkout-message").textContent.includes("وصلنا الطلب"));
  assert.equal(orderPayload.phone, "+212612345678");
  assert.equal(orderPayload.address, "الرباط، حي حسان");
  assert.equal(orderPayload.items[0].color, "أخضر");

  const home = await browser.newPage();
  await configureStorePage(home);
  await home.goto(`${baseURL}/`, { waitUntil: "commit" });
  await home.waitForLoadState("domcontentloaded");
  await home.locator(".product-card").nth(1).waitFor();
  await home.locator(".product-card").nth(1).locator(".order-button").dispatchEvent("click");
  assert.equal(await home.locator("#order-dialog").evaluate((dialog) => dialog.open), true);
  assert.ok((await home.locator("#selected-product").textContent()).includes(demoProducts[1].name));
  await page.close();
  await home.close();
}

async function configureAdminContext(context, mode = {}) {
  await context.route("**/data/config.json", (route) => route.fulfill({ json: demoConfig }));
  await context.route("https://worker.test/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": baseURL,
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type"
        }
      });
    }
    if (mode.network && path === "/admin/me") return route.abort("failed");
    if (path === "/admin/login") return workerResponse(route, { token: "session-token" });
    if (path === "/admin/me") {
      if (mode.expired) return workerResponse(route, { error: "Unauthorized." }, 401);
      return workerResponse(route, { email: "owner@example.com", token: "renewed-token" });
    }
    if (path === "/admin/content/products") return workerResponse(route, { value: demoProducts, sha: "products-sha" });
    if (path === "/admin/content/config") return workerResponse(route, { value: demoConfig, sha: "config-sha" });
    if (path === "/admin/orders") return workerResponse(route, { orders: [] });
    return workerResponse(route, { ok: true, sha: "saved-sha" });
  });
}

async function testAdmin() {
  const context = await browser.newContext();
  await configureAdminContext(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(`${baseURL}/admin.html`, { waitUntil: "commit" });
  await page.locator("#login-email").fill("owner@example.com");
  await page.locator("#login-password").fill("test-password");
  await page.locator("#login-form").dispatchEvent("submit");
  await page.locator("#admin-workspace:not([hidden])").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("mougamarket-admin-session")), "session-token");

  await page.reload({ waitUntil: "commit" });
  await page.locator("#admin-workspace:not([hidden])").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("mougamarket-admin-session")), "renewed-token");
  const newTab = await context.newPage();
  newTab.on("pageerror", (error) => failures.push(error.message));
  await newTab.goto(`${baseURL}/admin.html`, { waitUntil: "commit" });
  await newTab.locator("#admin-workspace:not([hidden])").waitFor();
  await page.locator(".sidebar-bottom [data-logout]").dispatchEvent("click");
  await page.locator("#login-form").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("mougamarket-admin-session")), null);
  await newTab.close();
  await context.close();

  const expiredContext = await browser.newContext();
  await configureAdminContext(expiredContext, { expired: true });
  await expiredContext.addInitScript(() => localStorage.setItem("mougamarket-admin-session", "expired-token"));
  const expiredPage = await expiredContext.newPage();
  expiredPage.on("pageerror", (error) => failures.push(error.message));
  await expiredPage.goto(`${baseURL}/admin.html`, { waitUntil: "commit" });
  await expiredPage.locator("#connection-message").getByText("expired").waitFor();
  assert.equal(await expiredPage.evaluate(() => localStorage.getItem("mougamarket-admin-session")), null);
  await expiredContext.close();

  const offlineContext = await browser.newContext();
  await configureAdminContext(offlineContext, { network: true });
  await offlineContext.addInitScript(() => localStorage.setItem("mougamarket-admin-session", "offline-token"));
  const offlinePage = await offlineContext.newPage();
  offlinePage.on("pageerror", (error) => failures.push(error.message));
  await offlinePage.goto(`${baseURL}/admin.html`, { waitUntil: "commit" });
  await offlinePage.locator("#connection-message").getByText("Network unavailable").waitFor();
  assert.equal(await offlinePage.evaluate(() => localStorage.getItem("mougamarket-admin-session")), "offline-token");
  await offlineContext.close();
}

try {
  await testStorefront();
  console.log("PASS storefront grid, variant selection, cart edits, order dialog, and phone normalization");
  await testAdmin();
  assert.deepEqual(failures, []);
  console.log("PASS admin login, refresh/new tab persistence, logout, 401 expiry, network retry, and no JS errors");
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
