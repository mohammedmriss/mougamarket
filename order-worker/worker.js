const ORDER_STATUSES = new Set(["new", "confirmed", "shipped", "delivered", "cancelled"]);
const MAX_BODY = 20000;
const SESSION_SECONDS = 14 * 24 * 60 * 60;
const encoder = new TextEncoder();

function originFor(request, env) {
  const origin = request.headers.get("Origin") || "";
  return (env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function respond(payload, status, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function b64url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeB64url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), (char) => char.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createSession(email, secret, now = Math.floor(Date.now() / 1000)) {
  const payload = b64url(encoder.encode(JSON.stringify({ email, iat: now, exp: now + SESSION_SECONDS })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)));
  return `${payload}.${b64url(signature)}`;
}

async function verifySession(token, secret, adminEmail, now = Math.floor(Date.now() / 1000)) {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    if (!await crypto.subtle.verify("HMAC", await hmacKey(secret), decodeB64url(parts[1]), encoder.encode(parts[0]))) return false;
    const payload = JSON.parse(new TextDecoder().decode(decodeB64url(parts[0])));
    return payload.email === adminEmail && Number.isInteger(payload.iat) && Number.isInteger(payload.exp) &&
      payload.exp > now && payload.iat <= now + 60 && payload.exp - payload.iat === SESSION_SECONDS;
  } catch {
    return false;
  }
}

async function verifyPassword(password, encodedHash) {
  const parts = String(encodedHash || "").split("$");
  const iterations = Number(parts[1]);
  let salt = new Uint8Array(16);
  let expected = new Uint8Array(32);
  if (parts.length === 4 && parts[0] === "pbkdf2" && Number.isInteger(iterations) && iterations >= 100000 && iterations <= 1000000) {
    try {
      salt = decodeB64url(parts[2]);
      expected = decodeB64url(parts[3]);
      if (expected.length !== 32) throw new Error("Invalid hash");
    } catch {
      return false;
    }
  } else {
    return false;
  }
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256));
  let difference = derived.length ^ expected.length;
  for (let i = 0; i < derived.length; i += 1) difference |= derived[i] ^ (expected[i] || 0);
  return difference === 0;
}

function ipAddress(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function login(request, env, origin) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) return respond({ error: "Service unavailable." }, 503, origin);
  if (Number(request.headers.get("Content-Length") || 0) > 4096) return respond({ error: "Invalid request." }, 413, origin);
  const ip = ipAddress(request);
  const key = `login:${ip}`;
  if (env.LOGIN_KV) {
    const record = await env.LOGIN_KV.get(key, "json");
    if (record?.lockedUntil > Date.now()) return respond({ error: "Too many attempts. Try again later." }, 429, origin);
  }
  let body = {};
  try {
    const text = await readLimitedBody(request, 4096);
    if (text === null) return respond({ error: "Invalid request." }, 413, origin);
    body = JSON.parse(text);
  } catch { return respond({ error: "Invalid request." }, 400, origin); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const passwordValid = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
  const accepted = email === env.ADMIN_EMAIL.trim().toLowerCase() && passwordValid;
  if (!accepted) {
    if (env.LOGIN_KV) {
      const previous = await env.LOGIN_KV.get(key, "json") || { count: 0 };
      const count = previous.count + 1;
      await env.LOGIN_KV.put(key, JSON.stringify({ count, lockedUntil: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0 }), { expirationTtl: 900 });
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    return respond({ error: "Invalid email or password." }, 401, origin);
  }
  if (env.LOGIN_KV) await env.LOGIN_KV.delete(key);
  return respond({ token: await createSession(env.ADMIN_EMAIL.trim().toLowerCase(), env.SESSION_SECRET) }, 200, origin);
}

async function authorized(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return verifySession(token, env.SESSION_SECRET, env.ADMIN_EMAIL);
}

function githubPath(path, env) {
  const [owner, repo] = (env.GITHUB_REPO || "").split("/");
  if (!owner || !repo) throw new Error("GitHub repository is not configured.");
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
}

async function githubRequest(path, env, options = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("GitHub is not configured.");
  const response = await fetch(githubPath(path, env), {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "MougaMarket-Worker/1.0",
      "Cache-Control": "no-cache",
      ...options.headers
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("GitHub request failed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function readContent(name, env) {
  const file = await githubRequest(`data/${name}.json?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`, env);
  if (!file.content || file.encoding !== "base64") throw new Error("Invalid content file.");
  const binary = atob(file.content.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return { value: JSON.parse(new TextDecoder().decode(bytes)), sha: file.sha };
}

async function writeContent(name, value, env, sha) {
  const content = btoa(unescape(encodeURIComponent(`${JSON.stringify(value, null, 2)}\n`)));
  return githubRequest(`data/${name}.json`, env, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Update ${name} from MougaMarket admin`,
      content,
      sha,
      branch: env.GITHUB_BRANCH || "main"
    })
  });
}

async function sheetsRequest(env, payload) {
  const response = await fetch(env.SHEETS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret: env.SHEETS_WEBHOOK_SECRET })
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error("Sheets request failed.");
  return result;
}

async function createOrder(request, env, origin) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    return respond({ error: "معلومات الطلب غير صحيحة." }, 415, origin);
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY) return respond({ error: "الطلب كبير بزاف." }, 413, origin);
  let body;
  try {
    const text = await readLimitedBody(request, MAX_BODY);
    if (text === null) return respond({ error: "الطلب كبير بزاف." }, 413, origin);
    body = JSON.parse(text);
  } catch {
    return respond({ error: "معلومات الطلب غير صحيحة." }, 400, origin);
  }
  if (body.website) return respond({ ok: true }, 200, origin);
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!validText(body.name, 100) || !validText(body.address || body.city, 200) ||
      !/^\+212[5-7]\d{8}$/.test(phone) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    return respond({ error: "تأكد من المعلومات ورقم الهاتف ديالك." }, 400, origin);
  }
  if (env.ORDER_KV) {
    const key = `order:${ipAddress(request)}`;
    const count = Number(await env.ORDER_KV.get(key) || 0);
    if (count >= 12) return respond({ error: "صيفطتي طلبات بزاف. عاود من بعد شوية." }, 429, origin);
    await env.ORDER_KV.put(key, String(count + 1), { expirationTtl: 3600 });
  }
  let catalog;
  try {
    catalog = (await readContent("products", env)).value;
  } catch (error) {
    console.error("Product catalog lookup failed:", error);
    return respond({ error: "تعذر التحقق من المنتجات. عاود المحاولة من بعد." }, 502, origin);
  }
  const items = [];
  const quantities = new Map();
  for (const raw of body.items) {
    if (!raw || typeof raw.id !== "string" || !Number.isInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > 20) {
      return respond({ error: "تفاصيل المنتجات غير صحيحة." }, 400, origin);
    }
    const product = catalog.find((entry) => entry.id === raw.id);
    if (!product || product.status === "draft") return respond({ error: "شي منتج ما بقاش متوفر." }, 400, origin);
    if (!Number.isInteger(Number(product.stock)) || !Number.isFinite(Number(product.price)) || Number(product.price) <= 0) {
      return respond({ error: "تعذر التحقق من المنتج." }, 502, origin);
    }
    const lineKey = `${product.id}|${raw.size || ""}|${raw.color || ""}`;
    const aggregateQuantity = (quantities.get(lineKey) || 0) + raw.quantity;
    quantities.set(lineKey, aggregateQuantity);
    if (aggregateQuantity > Number(product.stock)) return respond({ error: "الكمية المطلوبة ما بقاتش متوفرة." }, 400, origin);
    if (!Array.isArray(product.sizes) || !Array.isArray(product.colors)) return respond({ error: "تعذر التحقق من خيارات المنتج." }, 502, origin);
    if (product.sizes.length && !product.sizes.includes(raw.size)) return respond({ error: "اختار المقاس ديال المنتج." }, 400, origin);
    if (product.colors.length && !product.colors.includes(raw.color)) return respond({ error: "اختار اللون ديال المنتج." }, 400, origin);
    if (raw.price !== undefined && Number(raw.price) !== Number(product.price)) {
      return respond({ error: "تبدل ثمن بعض المنتجات. حدّث الصفحة وعاود الطلب" }, 409, origin);
    }
    items.push({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      quantity: raw.quantity,
      size: product.sizes.length ? raw.size : "",
      color: product.colors.length ? raw.color : ""
    });
  }
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (!Number.isFinite(total) || total <= 0 || total > 10000000) return respond({ error: "المجموع غير صحيح." }, 400, origin);
  const order = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "new",
    name: body.name.trim(),
    phone,
    city: (body.address || body.city).trim(),
    items,
    total,
    itemsSummary: items.map((item) => `${item.name}${item.size ? ` (${item.size})` : ""}${item.color ? ` / ${item.color}` : ""} × ${item.quantity}`).join(", ")
  };
  try {
    await sheetsRequest(env, { action: "createOrder", order });
  } catch (error) {
    console.error("Order could not be saved:", error);
    return respond({ error: "ما قدرناش نسجلو الطلب. عاود المحاولة." }, 502, origin);
  }
  try {
    const result = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: `📦 طلب جديد من المتجر\n🔖 ${order.id}\n👤 ${order.name}\n📞 ${order.phone}\n📍 ${order.city}\n🛍️ ${order.itemsSummary}\n💰 ${total} درهم`
      })
    });
    if (!result.ok) console.error("Telegram notification failed:", result.status);
  } catch (error) {
    console.error("Telegram notification failed:", error);
  }
  return respond({ ok: true, orderId: order.id }, 200, origin);
}

async function readLimitedBody(request, limit) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(bytes);
}

function validText(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

async function adminRequest(request, env, origin, path) {
  if (path === "/admin/login" && request.method === "POST") return login(request, env, origin);
  if (!await authorized(request, env)) return respond({ error: "Unauthorized." }, 401, origin);
  if (path === "/admin/me" && request.method === "GET") {
    const token = await createSession(env.ADMIN_EMAIL.trim().toLowerCase(), env.SESSION_SECRET);
    return respond({ email: env.ADMIN_EMAIL, token }, 200, origin);
  }
  const content = path.match(/^\/admin\/content\/(products|config)$/);
  if (content && request.method === "GET") {
    try {
      const file = await readContent(content[1], env);
      return respond({ value: file.value, sha: file.sha }, 200, origin);
    } catch (error) {
      console.error("Content read failed:", error);
      return respond({ error: "Could not load content." }, error.status === 404 ? 404 : 502, origin);
    }
  }
  if (content && request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return respond({ error: "Invalid request." }, 400, origin); }
    if (!body || typeof body.sha !== "string" || body.value === undefined) return respond({ error: "Invalid content." }, 400, origin);
    try {
      const saved = await writeContent(content[1], body.value, env, body.sha);
      return respond({ sha: saved.content.sha }, 200, origin);
    } catch (error) {
      console.error("Content write failed:", error);
      return respond({ error: error.status === 409 || error.status === 422 ? "The file changed, reload the page" : "Could not save content." }, error.status === 409 || error.status === 422 ? 409 : 502, origin);
    }
  }
  if (path === "/admin/orders" && request.method === "GET") {
    try {
      const result = await sheetsRequest(env, { action: "listOrders" });
      return respond({ orders: result.orders || [] }, 200, origin);
    } catch (error) {
      console.error("Orders could not be loaded:", error);
      return respond({ error: "Could not load orders." }, 502, origin);
    }
  }
  if (path === "/admin/orders" && request.method === "PATCH") {
    let update;
    try { update = await request.json(); } catch { return respond({ error: "Invalid request." }, 400, origin); }
    if (!validText(update.orderId, 80) || !ORDER_STATUSES.has(update.status)) return respond({ error: "Invalid order or status." }, 400, origin);
    try {
      const result = await sheetsRequest(env, { action: "updateOrder", orderId: update.orderId, status: update.status });
      return result.updated ? respond({ ok: true }, 200, origin) : respond({ error: "Order not found." }, 404, origin);
    } catch (error) {
      console.error("Order update failed:", error);
      return respond({ error: "Could not update order." }, 502, origin);
    }
  }
  return respond({ error: "Not found." }, 404, origin);
}

export default {
  async fetch(request, env) {
    const origin = originFor(request, env);
    if (!origin) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (path === "/orders" && request.method === "POST") return createOrder(request, env, origin);
    if (path.startsWith("/admin/")) return adminRequest(request, env, origin, path);
    return respond({ error: "Not found." }, 404, origin);
  }
};
