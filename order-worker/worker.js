const ORDER_STATUSES = new Set(["new", "confirmed", "shipped", "delivered", "cancelled"]);

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(payload, status, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function validText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
}

async function signAdminSession(email, env) {
  const payload = encodeBase64Url(JSON.stringify({
    email,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
  }));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_API_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${payload}.${signatureBase64}`;
}

async function getAdminSession(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !env.ADMIN_API_KEY) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.ADMIN_API_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const signatureBytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - signature.length % 4) % 4)), (char) => char.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(payload));
    if (!valid) return null;
    const session = JSON.parse(decodeBase64Url(payload));
    if (!validText(session.email, 254) || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

async function createAdminSession(request, env, origin) {
  if (!env.ADMIN_LOGIN_EMAIL || !env.ADMIN_LOGIN_PASSWORD || !env.ADMIN_API_KEY) {
    return jsonResponse({ error: "Admin login is not configured." }, 503, origin);
  }
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
    return jsonResponse({ error: "Expected a JSON request." }, 415, origin);
  }
  let credentials;
  try {
    credentials = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON." }, 400, origin);
  }
  const email = typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  if (email.length > 254 || password.length < 10 || password.length > 256) {
    return jsonResponse({ error: "Invalid sign-in details." }, 400, origin);
  }
  const expectedEmail = env.ADMIN_LOGIN_EMAIL.trim().toLowerCase();
  if (!constantTimeEqual(email, expectedEmail) || !constantTimeEqual(password, env.ADMIN_LOGIN_PASSWORD)) {
    return jsonResponse({ error: "Email or password is incorrect." }, 401, origin);
  }
  const sessionToken = await signAdminSession(email, env);
  return jsonResponse({ sessionToken, email, expiresIn: 30 * 24 * 60 * 60 }, 200, origin);
}

async function verifyAdminSession(request, env, origin) {
  const session = await getAdminSession(request, env);
  if (!session) return jsonResponse({ error: "Session expired. Sign in again." }, 401, origin);
  return jsonResponse({ email: session.email, expiresAt: session.expiresAt }, 200, origin);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Connected service returned invalid JSON (${response.status}).`);
  }
}

async function sheetsRequest(env, payload) {
  if (!env.SHEETS_WEB_APP_URL || !env.SHEETS_WEBHOOK_SECRET) {
    throw new Error("Google Sheets service is not configured.");
  }
  const response = await fetch(env.SHEETS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret: env.SHEETS_WEBHOOK_SECRET })
  });
  const result = await readJson(response);
  if (!response.ok || result.ok !== true) throw new Error(result.error || "Google Sheets request failed.");
  return result;
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 20) return null;
  const items = [];
  for (const item of rawItems) {
    if (!validText(item.name, 120) || !Number.isFinite(item.price) || item.price <= 0 || item.price > 10000000) return null;
    const quantity = Number(item.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return null;
    items.push({
      id: typeof item.id === "string" ? item.id.slice(0, 120) : "",
      name: item.name.trim(),
      price: item.price,
      quantity,
      size: typeof item.size === "string" ? item.size.slice(0, 40) : "",
      color: typeof item.color === "string" ? item.color.slice(0, 40) : ""
    });
  }
  return items;
}

async function createOrder(request, env, origin) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return jsonResponse({ error: "Telegram order notifications are not configured." }, 503, origin);
  }
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
    return jsonResponse({ error: "Expected a JSON request." }, 415, origin);
  }
  if (Number(request.headers.get("Content-Length") || 0) > 10000) {
    return jsonResponse({ error: "Request is too large." }, 413, origin);
  }
  let order;
  try {
    order = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON." }, 400, origin);
  }
  if (order.website) return jsonResponse({ ok: true }, 200, origin);
  const phone = typeof order.phone === "string" ? order.phone.trim() : "";
  const items = normalizeItems(order.items);
  if (!validText(order.name, 100) || !validText(order.city, 80) ||
      !/^\+212[5-7]\d{8}$/.test(phone) || !items) {
    return jsonResponse({ error: "Invalid order details." }, 400, origin);
  }

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (!Number.isFinite(total) || total > 10000000) return jsonResponse({ error: "Order total is too high." }, 400, origin);
  const savedOrder = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "new",
    name: order.name.trim(),
    phone,
    city: order.city.trim(),
    items,
    total,
    itemsSummary: items.map((item) => `${item.name}${item.size ? ` (${item.size})` : ""}${item.color ? ` / ${item.color}` : ""} × ${item.quantity}`).join(", ")
  };

  try {
    await sheetsRequest(env, { action: "createOrder", order: savedOrder });
  } catch (error) {
    console.error("Could not store order in Google Sheets:", error.message);
    return jsonResponse({ error: "We could not save the order. Please try again." }, 502, origin);
  }

  const message = [
    "📦 طلب جديد من MougaMarket",
    `🔖 رقم الطلب: ${savedOrder.id}`,
    `👤 الاسم: ${savedOrder.name}`,
    `📞 الهاتف: ${savedOrder.phone}`,
    `🏙️ المدينة: ${savedOrder.city}`,
    `🛍️ المنتجات: ${savedOrder.itemsSummary}`,
    `💰 المجموع: ${new Intl.NumberFormat("fr-MA").format(total)} درهم`
  ].join("\n");
  try {
    const telegram = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message })
    });
    if (!telegram.ok) console.error("Telegram notification failed:", telegram.status);
  } catch (error) {
    console.error("Telegram notification could not be sent:", error.message);
  }
  return jsonResponse({ ok: true, orderId: savedOrder.id }, 200, origin);
}

async function handleAdminRequest(request, env, origin, pathname) {
  const session = await getAdminSession(request, env);
  if (!env.ADMIN_API_KEY || request.headers.get("X-Admin-Key") !== env.ADMIN_API_KEY || !session) {
    return jsonResponse({ error: "Unauthorized." }, 401, origin);
  }
  if (pathname === "/admin/orders" && request.method === "GET") {
    try {
      const result = await sheetsRequest(env, { action: "listOrders" });
      return jsonResponse({ orders: result.orders || [] }, 200, origin);
    } catch (error) {
      console.error("Could not load orders:", error.message);
      return jsonResponse({ error: "Could not load orders from Google Sheets." }, 502, origin);
    }
  }
  if (pathname === "/admin/orders" && request.method === "PATCH") {
    let update;
    try {
      update = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON." }, 400, origin);
    }
    if (!validText(update.orderId, 80) || !ORDER_STATUSES.has(update.status)) {
      return jsonResponse({ error: "Invalid order ID or status." }, 400, origin);
    }
    try {
      const result = await sheetsRequest(env, { action: "updateOrder", orderId: update.orderId, status: update.status });
      if (!result.updated) return jsonResponse({ error: "Order not found." }, 404, origin);
      return jsonResponse({ ok: true }, 200, origin);
    } catch (error) {
      console.error("Could not update order:", error.message);
      return jsonResponse({ error: "Could not update the order in Google Sheets." }, 502, origin);
    }
  }
  return jsonResponse({ error: "Not found." }, 404, origin);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/orders" && request.method === "POST") return createOrder(request, env, origin);
    if (pathname === "/admin/login" && request.method === "POST") return createAdminSession(request, env, origin);
    if (pathname === "/admin/session" && request.method === "GET") return verifyAdminSession(request, env, origin);
    if (pathname.startsWith("/admin/")) return handleAdminRequest(request, env, origin, pathname);
    return jsonResponse({ error: "Not found." }, 404, origin);
  }
};
