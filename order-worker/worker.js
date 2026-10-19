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
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
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
  if (!env.ADMIN_API_KEY || request.headers.get("X-Admin-Key") !== env.ADMIN_API_KEY) {
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
    if (pathname.startsWith("/admin/")) return handleAdminRequest(request, env, origin, pathname);
    return jsonResponse({ error: "Not found." }, 404, origin);
  }
};
