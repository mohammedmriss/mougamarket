const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});

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

function isValidText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      return jsonResponse({ error: "Order service is not configured" }, 503, origin);
    }
    if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
      return jsonResponse({ error: "Expected JSON request" }, 415, origin);
    }
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 4096) return jsonResponse({ error: "Request too large" }, 413, origin);

    let order;
    try {
      order = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, origin);
    }
    if (order.website) return jsonResponse({ ok: true }, 200, origin);
    if (!isValidText(order.name, 100) || !isValidText(order.city, 80) ||
        !isValidText(order.product, 120) || !/^\+212[5-7]\d{8}$/.test(order.phone) ||
        !Number.isFinite(order.price) || order.price <= 0 || order.price > 10000000) {
      return jsonResponse({ error: "Invalid order details" }, 400, origin);
    }

    const message = [
      "📦 طلب جديد من المتجر",
      `👤 الاسم: ${order.name.trim()}`,
      `📞 الهاتف: ${order.phone}`,
      `🏙️ المدينة: ${order.city.trim()}`,
      `🛍️ المنتج: ${order.product.trim()}`,
      `💰 الثمن: ${new Intl.NumberFormat("fr-MA").format(order.price)} درهم`
    ].join("\n");

    let telegramResponse;
    try {
      telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message })
      });
    } catch {
      return jsonResponse({ error: "Telegram could not be reached" }, 502, origin);
    }
    if (!telegramResponse.ok) {
      return jsonResponse({ error: "Telegram did not accept the order" }, 502, origin);
    }
    return jsonResponse({ ok: true }, 200, origin);
  }
};
