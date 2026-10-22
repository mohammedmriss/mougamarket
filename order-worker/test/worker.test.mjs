import test from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import worker from "../worker.js";

const origin = "https://mougamarket.store";
const email = "admin@example.com";
const salt = randomBytes(16);
const password = "a-long-test-password";
const encodedHash = `pbkdf2$100000$${salt.toString("base64")}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("base64")}`;
const products = [
  { id: "plain", name: "Plain item", price: 35, stock: 3, status: "active", sizes: [], colors: [] },
  { id: "colored", name: "Colored item", price: 120, stock: 2, status: "active", sizes: ["M"], colors: ["Red"] },
  { id: "draft", name: "Draft item", price: 10, stock: 4, status: "draft", sizes: [], colors: [] }
];

function environment(overrides = {}) {
  const calls = { sheets: [], telegram: [], github: [] };
  const env = {
    ADMIN_EMAIL: email,
    ADMIN_PASSWORD_HASH: encodedHash,
    SESSION_SECRET: "test-session-secret-that-is-long-enough",
    GITHUB_TOKEN: "test-token",
    GITHUB_REPO: "owner/repo",
    GITHUB_BRANCH: "main",
    SHEETS_WEB_APP_URL: "https://sheets.example.test",
    SHEETS_WEBHOOK_SECRET: "sheets-secret",
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_CHAT_ID: "chat-id",
    ALLOWED_ORIGINS: origin,
    ...overrides
  };
  return { env, calls };
}

function mockFetch(calls, options = {}) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.github.push({ url, ...init });
    if (url.includes("api.github.com")) {
      if (init.method === "PUT") {
        return Response.json({ content: { sha: "new-sha" } });
      }
      const value = options.catalog || products;
      return Response.json({
        sha: "current-sha",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(value)).toString("base64")
      });
    }
    if (url.includes("sheets.example.test")) {
      const payload = JSON.parse(init.body);
      calls.sheets.push(payload);
      return Response.json(options.sheetsResponse || { ok: true, updated: true, orders: [] });
    }
    if (url.includes("api.telegram.org")) {
      calls.telegram.push(JSON.parse(init.body));
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
}

function request(path, { method = "GET", body, token, requestOrigin = origin } = {}) {
  const headers = new Headers({ Origin: requestOrigin });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request(`https://worker.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function call(env, path, options) {
  const response = await worker.fetch(request(path, options), env);
  return { response, body: await response.json().catch(() => null) };
}

async function signedToken(secret, payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded))).toString("base64url");
  return `${encoded}.${signature}`;
}

test("login rejects wrong email and wrong password; accepts configured credentials", async () => {
  const { env, calls } = environment();
  mockFetch(calls);
  const wrongEmail = await call(env, "/admin/login", { method: "POST", body: { email: "else@example.com", password } });
  assert.equal(wrongEmail.response.status, 401);
  const wrongPassword = await call(env, "/admin/login", { method: "POST", body: { email, password: "wrong-password" } });
  assert.equal(wrongPassword.response.status, 401);
  const accepted = await call(env, "/admin/login", { method: "POST", body: { email, password } });
  assert.equal(accepted.response.status, 200);
  assert.match(accepted.body.token, /^[\w-]+\.[\w-]+$/);
});

test("login and session renewal normalize the configured admin email", async () => {
  const { env, calls } = environment({ ADMIN_EMAIL: "  Admin@Example.com  " });
  mockFetch(calls);
  const login = await call(env, "/admin/login", { method: "POST", body: { email: "admin@example.com", password } });
  assert.equal(login.response.status, 200);
  const session = await call(env, "/admin/me", { token: login.body.token });
  assert.equal(session.response.status, 200);
  assert.equal(session.body.email, "admin@example.com");
});

test("sessions reject tampering, forged signatures, expired tokens, and missing tokens", async () => {
  const { env, calls } = environment();
  mockFetch(calls);
  const login = await call(env, "/admin/login", { method: "POST", body: { email, password } });
  const token = login.body.token;
  assert.equal((await call(env, "/admin/me", { token: `${token}x` })).response.status, 401);
  const forged = `${Buffer.from(JSON.stringify({ email, iat: 100, exp: 9999999999 })).toString("base64url")}.forged`;
  assert.equal((await call(env, "/admin/me", { token: forged })).response.status, 401);
  const expired = await signedToken(env.SESSION_SECRET, { email, iat: 100, exp: 101 });
  assert.equal((await call(env, "/admin/me", { token: expired })).response.status, 401);
  assert.equal((await call(env, "/admin/orders")).response.status, 401);
  const renewed = await call(env, "/admin/me", { token });
  assert.equal(renewed.response.status, 200);
  assert.ok(renewed.body.token);
});

test("foreign origins are rejected", async () => {
  const { env, calls } = environment();
  mockFetch(calls);
  const result = await call(env, "/admin/login", { method: "POST", requestOrigin: "https://evil.example", body: { email, password } });
  assert.equal(result.response.status, 403);
});

test("admin content GET and PUT use GitHub sha and report stale updates", async () => {
  const { env, calls } = environment();
  mockFetch(calls);
  const login = await call(env, "/admin/login", { method: "POST", body: { email, password } });
  const token = login.body.token;
  const read = await call(env, "/admin/content/products", { token });
  assert.equal(read.response.status, 200);
  assert.equal(read.body.sha, "current-sha");
  assert.equal(calls.github[0].headers["User-Agent"], "MougaMarket-Worker/1.0");
  const put = await call(env, "/admin/content/products", { method: "PUT", token, body: { sha: "current-sha", value: products } });
  assert.equal(put.response.status, 200);
  assert.equal(put.body.sha, "new-sha");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: "sha mismatch" }, { status: 409 });
  const stale = await call(env, "/admin/content/config", { method: "PUT", token, body: { sha: "old", value: {} } });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error, "The file changed, reload the page");
  globalThis.fetch = originalFetch;
});

test("orders reject price tampering, insufficient stock, drafts, missing variants, and bad phones", async () => {
  const { env, calls } = environment();
  mockFetch(calls);
  const mismatch = await call(env, "/orders", { method: "POST", body: { name: "Test", phone: "+212612345678", address: "Rabat", items: [{ id: "plain", price: 36, quantity: 1 }] } });
  assert.equal(mismatch.response.status, 409);
  assert.equal(mismatch.body.error, "تبدل ثمن بعض المنتجات. حدّث الصفحة وعاود الطلب");
  const stock = await call(env, "/orders", { method: "POST", body: { name: "Test", phone: "+212612345678", address: "Rabat", items: [{ id: "plain", price: 35, quantity: 4 }] } });
  assert.equal(stock.response.status, 400);
  const draft = await call(env, "/orders", { method: "POST", body: { name: "Test", phone: "+212612345678", address: "Rabat", items: [{ id: "draft", price: 10, quantity: 1 }] } });
  assert.equal(draft.response.status, 400);
  const noColor = await call(env, "/orders", { method: "POST", body: { name: "Test", phone: "+212612345678", address: "Rabat", items: [{ id: "colored", price: 120, quantity: 1, size: "M" }] } });
  assert.equal(noColor.response.status, 400);
  const badPhone = await call(env, "/orders", { method: "POST", body: { name: "Test", phone: "0612345678", address: "Rabat", items: [{ id: "plain", price: 35, quantity: 1 }] } });
  assert.equal(badPhone.response.status, 400);
});

test("valid order uses catalog pricing and persists before Telegram notification", async () => {
  const { env, calls } = environment();
  mockFetch(calls);
  const result = await call(env, "/orders", {
    method: "POST",
    body: {
      name: "Customer",
      phone: "+212612345678",
      address: "Rabat, Hassan",
      items: [
        { id: "plain", name: "Forged name", price: 35, quantity: 2 },
        { id: "colored", price: 120, quantity: 1, size: "M", color: "Red" }
      ]
    }
  });
  assert.equal(result.response.status, 200);
  assert.equal(calls.sheets[0].order.total, 190);
  assert.equal(calls.sheets[0].order.items[0].name, "Plain item");
  assert.equal(calls.sheets[0].order.items[1].color, "Red");
  assert.equal(calls.telegram.length, 1);
  assert.ok(calls.github.some((call) => call.url.includes("api.github.com/repos/owner/repo/contents/data/products.json")));
});
