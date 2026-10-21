export const demoProducts = [
  {
    id: "colored-item",
    name: "منتج بالألوان",
    category: "إكسسوارات",
    price: 129,
    stock: 4,
    status: "active",
    badge: "",
    images: ["https://example.test/image.jpg"],
    sizes: [],
    colors: ["أخضر", "أبيض"],
    description: "منتج تجريبي"
  },
  {
    id: "plain-item",
    name: "منتج عادي",
    category: "المنزل",
    price: 99,
    stock: 5,
    status: "active",
    badge: "",
    images: ["https://example.test/image2.jpg"],
    sizes: [],
    colors: [],
    description: "منتج آخر"
  }
];

export const demoConfig = {
  store_name: "MougaMarket test",
  logo_url: "",
  announcement_text: "توصيل سريع",
  store_phone: "+212612345678",
  order_endpoint: "https://worker.test",
  theme: { primary_color: "#2563eb", font_family: "system-ui, sans-serif" },
  slider_images: []
};

export async function installStoreFixtures(page) {
  await page.route("**/data/products.json", async (route) => {
    await route.fulfill({ json: demoProducts });
  });
  await page.route("**/data/config.json", async (route) => {
    await route.fulfill({ json: demoConfig });
  });
  await page.route("https://example.test/**", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'></svg>"
  }));
}

export async function installWorkerCors(page, handler) {
  await page.route("https://worker.test/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "http://127.0.0.1:4173",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400"
        }
      });
      return;
    }
    await handler(corsRoute(route));
  });
}

export function corsRoute(route) {
  return new Proxy(route, {
    get(target, property) {
      if (property === "fulfill") {
        return (options = {}) => target.fulfill({
          ...options,
          headers: { ...options.headers, "Access-Control-Allow-Origin": "http://127.0.0.1:4173" }
        });
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
