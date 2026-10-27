const $ = (selector) => document.querySelector(selector);
const TOKEN_KEY = "mougamarket-admin-session";
const PAGE_SIZE = 8;
const views = [...document.querySelectorAll(".admin-view")];
const editor = $("#product-editor");
let workerEndpoint = "";
let token = localStorage.getItem(TOKEN_KEY) || "";
let products = [];
let config = {};
let orders = [];
let shas = {};
let currentPage = 1;

function message(target, text, type = "") {
  target.textContent = text;
  target.className = `admin-message${type ? ` ${type}` : ""}`;
}

function sessionExpired(text = "Your session expired. Please log in again.") {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  $("#admin-workspace").hidden = true;
  $("#connection-panel").hidden = false;
  document.querySelectorAll("[data-logout]").forEach((button) => { button.hidden = true; });
  $("#connection-title").textContent = "Sign in to your store";
  message($("#connection-message"), text, "error");
}

async function workerRequest(path, options = {}) {
  const response = await fetch(new URL(path, workerEndpoint), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    sessionExpired("Your session expired. Please log in again.");
    throw new Error("Session expired.");
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

async function loadContent(name) {
  const result = await workerRequest(`/admin/content/${name}`);
  shas[name] = result.sha;
  return result.value;
}

async function saveContent(name, value) {
  const result = await workerRequest(`/admin/content/${name}`, {
    method: "PUT",
    body: JSON.stringify({ value, sha: shas[name] })
  });
  shas[name] = result.sha;
}

function cell(value) {
  const td = document.createElement("td");
  td.textContent = String(value ?? "");
  return td;
}

function formatOrderDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-MA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function emptyRow(span, text) {
  const row = document.createElement("tr");
  const item = cell(text);
  item.colSpan = span;
  row.append(item);
  return row;
}

function button(text, action, className = "") {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = text;
  item.className = className;
  item.addEventListener("click", action);
  return item;
}

function normalizedProduct(source) {
  const images = Array.isArray(source.images) ? source.images : [source.image].filter(Boolean);
  return {
    ...source,
    id: String(source.id || ""),
    name: String(source.name || ""),
    category: String(source.category || "Uncategorized"),
    price: Number(source.price) || 0,
    stock: Number.isInteger(Number(source.stock)) ? Number(source.stock) : 0,
    status: source.status === "draft" ? "draft" : "active",
    images,
    image: images[0] || "",
    sizes: Array.isArray(source.sizes) ? source.sizes : [],
    colors: Array.isArray(source.colors) ? source.colors : []
  };
}

function updateCategoryFilter() {
  const filter = $("#product-category-filter");
  const current = filter.value;
  const categories = [...new Set(products.map((item) => normalizedProduct(item).category))].sort();
  filter.replaceChildren(new Option("All categories", ""), ...categories.map((name) => new Option(name, name)));
  filter.value = categories.includes(current) ? current : "";
}

function renderProducts() {
  const tbody = $("#products-table");
  tbody.replaceChildren();
  const query = $("#product-search").value.trim().toLocaleLowerCase();
  const category = $("#product-category-filter").value;
  const filtered = products.map(normalizedProduct).filter((product) =>
    (!query || `${product.name} ${product.category}`.toLocaleLowerCase().includes(query)) &&
    (!category || product.category === category)
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pages);
  const start = (currentPage - 1) * PAGE_SIZE;
  filtered.slice(start, start + PAGE_SIZE).forEach((product) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const info = document.createElement("div");
    info.className = "table-product";
    const image = document.createElement("img");
    image.src = product.image;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.removeAttribute("src"), { once: true });
    const text = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = product.name;
    const id = document.createElement("small");
    id.textContent = product.id;
    text.append(name, id);
    info.append(image, text);
    nameCell.append(info);
    row.append(nameCell, cell(product.category), cell(`${product.price} MAD`), cell(product.stock));
    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `status-badge ${product.status}`;
    status.textContent = product.status;
    statusCell.append(status);
    row.append(statusCell);
    const actions = document.createElement("td");
    const group = document.createElement("div");
    group.className = "row-actions";
    group.append(button("Edit", () => editProduct(product.id)), button("Delete", () => deleteProduct(product.id), "delete-action"));
    actions.append(group);
    row.append(actions);
    tbody.append(row);
  });
  if (!filtered.length) tbody.append(emptyRow(6, "No products match your search."));
  $("#pagination-summary").textContent = filtered.length ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length}` : "No products";
  $("#page-number").textContent = `${currentPage} / ${pages}`;
  $("#page-previous").disabled = currentPage <= 1;
  $("#page-next").disabled = currentPage >= pages;
  updateCategoryFilter();
  $("#stat-products").textContent = String(products.length);
  $("#stat-active").textContent = String(products.filter((item) => item.status !== "draft").length);
}

function renderCategories() {
  const counts = new Map();
  products.forEach((item) => {
    const category = normalizedProduct(item).category;
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  const grid = $("#categories-grid");
  grid.replaceChildren();
  [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([name, count]) => {
    const card = document.createElement("article");
    card.className = "category-card";
    const title = document.createElement("strong");
    title.textContent = name;
    const number = document.createElement("span");
    number.textContent = `${count} product${count === 1 ? "" : "s"}`;
    card.append(title, number);
    grid.append(card);
  });
  message($("#categories-message"), counts.size ? "" : "Categories appear when you add products.");
}

function editProduct(id) {
  const source = products.find((item) => item.id === id);
  if (!source) return;
  const product = normalizedProduct(source);
  $("#product-id").value = product.id;
  $("#product-name").value = product.name;
  $("#product-category").value = product.category;
  $("#product-price").value = product.price;
  $("#product-stock").value = product.stock;
  $("#product-status").value = product.status;
  $("#product-badge").value = product.badge || "";
  $("#product-sizes").value = product.sizes.join(", ");
  $("#product-colors").value = product.colors.join(", ");
  $("#product-images").value = product.images.join("\n");
  $("#product-description").value = product.description || "";
  $("#editor-title").textContent = "Edit product";
  editor.hidden = false;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetProductForm() {
  $("#product-form").reset();
  $("#product-id").value = "";
  $("#editor-title").textContent = "Add product";
  message($("#editor-message"), "");
}

function showView(name) {
  views.forEach((item) => item.classList.toggle("active", item.dataset.panel === name));
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  const titles = { dashboard: "Dashboard", products: "Product List", categories: "Categories", orders: "Sales / Orders", analytics: "Analytics", settings: "Settings" };
  $("#view-title").textContent = titles[name] || "Dashboard";
  if (name === "categories") renderCategories();
  if (name === "settings") fillSettings();
  if (name === "orders" || name === "dashboard" || name === "analytics") refreshOrders();
  $(".admin-shell").classList.remove("menu-open");
}

function renderOrders() {
  const selection = $("#order-status-filter").value;
  const list = orders.filter((order) => !selection || order.status === selection);
  const tbody = $("#orders-table");
  tbody.replaceChildren();
  list.forEach((order) => {
    const row = document.createElement("tr");
    row.append(cell(String(order.id || "").slice(0, 8)), cell(formatOrderDate(order.createdAt)), cell(order.name), cell(`${order.phone || ""} / ${order.city || ""}`), cell(order.itemsSummary), cell(`${order.total || 0} MAD`));
    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${order.status || "new"}`;
    badge.textContent = order.status || "new";
    statusCell.append(badge);
    row.append(statusCell);
    const updateCell = document.createElement("td");
    const select = document.createElement("select");
    select.className = "order-status-select";
    ["new", "confirmed", "shipped", "delivered", "cancelled"].forEach((status) => select.add(new Option(status, status)));
    select.value = order.status || "new";
    select.addEventListener("change", () => updateOrderStatus(order.id, select.value, select));
    updateCell.append(select);
    row.append(updateCell);
    tbody.append(row);
  });
  if (!list.length) tbody.append(emptyRow(8, "No orders yet."));
  renderDashboardOrders();
  renderAnalytics();
}

function renderDashboardOrders() {
  const tbody = $("#recent-orders");
  tbody.replaceChildren();
  orders.slice(0, 5).forEach((order) => {
    const row = document.createElement("tr");
    row.append(cell(String(order.id || "").slice(0, 8)), cell(order.name), cell(order.itemsSummary), cell(`${order.total || 0} MAD`));
    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${order.status || "new"}`;
    badge.textContent = order.status || "new";
    statusCell.append(badge);
    row.append(statusCell);
    tbody.append(row);
  });
  if (!orders.length) tbody.append(emptyRow(5, "No orders yet."));
}

function renderAnalytics() {
  const validOrders = orders.filter((order) => order.status !== "cancelled");
  const revenue = validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  $("#stat-orders").textContent = String(orders.length);
  $("#stat-sales").textContent = `${revenue.toFixed(2)} MAD`;
  $("#analytics-orders").textContent = String(orders.length);
  $("#analytics-revenue").textContent = `${revenue.toFixed(2)} MAD`;
  $("#analytics-average").textContent = `${(validOrders.length ? revenue / validOrders.length : 0).toFixed(2)} MAD`;
  $("#analytics-pending").textContent = String(orders.filter((order) => ["new", "confirmed"].includes(order.status)).length);
  const sales = new Map();
  validOrders.forEach((order) => (order.items || []).forEach((item) => sales.set(item.name, (sales.get(item.name) || 0) + Number(item.quantity || 1))));
  const root = $("#best-sellers");
  root.replaceChildren();
  [...sales.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([name, amount]) => {
    const row = document.createElement("div");
    row.className = "best-seller-row";
    const label = document.createElement("span");
    label.textContent = name;
    const count = document.createElement("strong");
    count.textContent = String(amount);
    row.append(label, count);
    root.append(row);
  });
}

async function refreshOrders() {
  message($("#orders-message"), "Loading orders...");
  try {
    const result = await workerRequest("/admin/orders");
    orders = Array.isArray(result.orders) ? result.orders : [];
    renderOrders();
    message($("#orders-message"), `${orders.length} orders loaded.`, "success");
  } catch (error) {
    if (token) message($("#orders-message"), error.message, "error");
  }
}

async function updateOrderStatus(id, status, select) {
  select.disabled = true;
  try {
    await workerRequest("/admin/orders", { method: "PATCH", body: JSON.stringify({ orderId: id, status }) });
    const order = orders.find((item) => item.id === id);
    if (order) order.status = status;
    renderOrders();
    message($("#orders-message"), "Order status updated.", "success");
  } catch (error) {
    message($("#orders-message"), error.message, "error");
  } finally {
    select.disabled = false;
  }
}

function fillSettings() {
  $("#setting-store-name").value = config.store_name || "";
  $("#setting-announcement").value = config.announcement_text || "";
  $("#setting-primary-color").value = /^#[0-9a-f]{6}$/i.test(config.theme?.primary_color || "") ? config.theme.primary_color : "#2563eb";
  $("#setting-font").value = config.theme?.font_family || "system-ui, sans-serif";
  $("#setting-logo").value = config.logo_url || "";
  $("#setting-phone").value = config.store_phone || "";
  $("#setting-pixel").value = config.facebook_pixel_id || "";
  $("#setting-slides").value = JSON.stringify(config.slider_images || [], null, 2);
}

async function deleteProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product || !confirm(`Delete "${product.name}" from the catalog?`)) return;
  const previous = products;
  products = products.filter((item) => item.id !== id);
  try {
    await saveContent("products", products);
    renderProducts();
    message($("#products-message"), "Product deleted and saved.", "success");
  } catch (error) {
    products = previous;
    renderProducts();
    message($("#products-message"), error.message, "error");
  }
}

async function loadWorkspace() {
  const [loadedProducts, loadedConfig] = await Promise.all([loadContent("products"), loadContent("config")]);
  if (!Array.isArray(loadedProducts)) throw new Error("The products file has an invalid format.");
  products = loadedProducts;
  config = loadedConfig;
  $("#connection-panel").hidden = true;
  $("#admin-workspace").hidden = false;
  document.querySelectorAll("[data-logout]").forEach((button) => { button.hidden = false; });
  $("#connection-indicator").textContent = "Connected";
  $("#connection-indicator").classList.add("connected");
  renderProducts();
  fillSettings();
  await refreshOrders();
}

async function establishSession() {
  try {
    const result = await workerRequest("/admin/me");
    token = result.token;
    localStorage.setItem(TOKEN_KEY, token);
    await loadWorkspace();
  } catch (error) {
    if (!token) return;
    if (/Session expired/.test(error.message)) return;
    $("#connection-panel").hidden = false;
    $("#admin-workspace").hidden = true;
    $("#retry-session").hidden = false;
    message($("#connection-message"), "Network unavailable. Your session is saved; retry when online.", "error");
  }
}

async function loadEndpoint() {
  const response = await fetch("data/config.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("Could not load the store configuration.");
  const settings = await response.json();
  if (!settings.order_endpoint) throw new Error("The Worker endpoint is not configured.");
  workerEndpoint = settings.order_endpoint;
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("#login-button");
  submit.disabled = true;
  message($("#connection-message"), "");
  try {
    const response = await fetch(new URL("/admin/login", workerEndpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("#login-email").value.trim(), password: $("#login-password").value })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Login failed.");
    token = result.token;
    localStorage.setItem(TOKEN_KEY, token);
    $("#login-password").value = "";
    await loadWorkspace();
  } catch (error) {
    message($("#connection-message"), error.message || "Network unavailable. Try again.", "error");
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", () => sessionExpired("You have been logged out.")));
$("#retry-session").addEventListener("click", establishSession);
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
document.querySelectorAll("[data-open-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.openView)));
$("#mobile-menu").addEventListener("click", () => $(".admin-shell").classList.toggle("menu-open"));
$("#product-search").addEventListener("input", () => { currentPage = 1; renderProducts(); });
$("#product-category-filter").addEventListener("change", () => { currentPage = 1; renderProducts(); });
$("#page-previous").addEventListener("click", () => { currentPage -= 1; renderProducts(); });
$("#page-next").addEventListener("click", () => { currentPage += 1; renderProducts(); });
$("#new-product").addEventListener("click", () => { resetProductForm(); editor.hidden = false; editor.scrollIntoView({ behavior: "smooth" }); });
$("#close-editor").addEventListener("click", () => { editor.hidden = true; });
$("#cancel-edit").addEventListener("click", () => { editor.hidden = true; });
$("#refresh-orders").addEventListener("click", refreshOrders);
$("#order-status-filter").addEventListener("change", renderOrders);

$("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#product-id").value.trim() || crypto.randomUUID();
  const images = $("#product-images").value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const product = {
    id,
    name: $("#product-name").value.trim(),
    category: $("#product-category").value.trim(),
    price: Number($("#product-price").value),
    stock: Number($("#product-stock").value),
    status: $("#product-status").value,
    badge: $("#product-badge").value.trim(),
    images,
    image: images[0] || "",
    sizes: $("#product-sizes").value.split(",").map((value) => value.trim()).filter(Boolean),
    colors: $("#product-colors").value.split(",").map((value) => value.trim()).filter(Boolean),
    description: $("#product-description").value.trim()
  };
  const previous = products;
  const index = products.findIndex((item) => item.id === id);
  products = [...products];
  if (index < 0) products.push(product);
  else products[index] = product;
  try {
    await saveContent("products", products);
    renderProducts();
    editor.hidden = true;
    message($("#products-message"), "Product saved.", "success");
  } catch (error) {
    products = previous;
    message($("#editor-message"), error.message, "error");
  }
});

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  let slides;
  try { slides = JSON.parse($("#setting-slides").value || "[]"); } catch {
    message($("#settings-message"), "Slides must be valid JSON.", "error");
    return;
  }
  if (!Array.isArray(slides)) {
    message($("#settings-message"), "Slides must be a JSON array.", "error");
    return;
  }
  const updated = {
    ...config,
    store_name: $("#setting-store-name").value.trim(),
    announcement_text: $("#setting-announcement").value.trim(),
    logo_url: $("#setting-logo").value.trim(),
    store_phone: $("#setting-phone").value.trim(),
    facebook_pixel_id: $("#setting-pixel").value.trim(),
    theme: { ...(config.theme || {}), primary_color: $("#setting-primary-color").value, font_family: $("#setting-font").value.trim() },
    slider_images: slides
  };
  try {
    await saveContent("config", updated);
    config = updated;
    message($("#settings-message"), "Settings saved to GitHub.", "success");
  } catch (error) {
    message($("#settings-message"), error.message, "error");
  }
});

(async function initialize() {
  try {
    await loadEndpoint();
    if (token) {
      $("#retry-session").hidden = true;
      await establishSession();
    } else {
      $("#connection-panel").hidden = false;
      $("#admin-workspace").hidden = true;
    }
  } catch (error) {
    $("#connection-panel").hidden = false;
    $("#retry-session").hidden = false;
    message($("#connection-message"), error.message, "error");
  }
})();
