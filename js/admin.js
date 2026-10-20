const $ = (selector) => document.querySelector(selector);
const connectionForm = $("#connection-form");
const workspace = $("#admin-workspace");
const views = [...document.querySelectorAll(".admin-view")];
const productForm = $("#product-form");
const editor = $("#product-editor");
const PRODUCTS_PATH = "data/products.json";
const CONFIG_PATH = "data/config.json";
const API_ROOT = "https://api.github.com";
const PAGE_SIZE = 8;
const CONNECTION_KEY = "mougamarket-admin-connection";
const SESSION_KEY = "mougamarket-admin-session";

let githubToken = "";
let repository = "";
let branch = "main";
let workerEndpoint = "";
let products = [];
let config = {};
let orders = [];
let fileShas = {};
let currentPage = 1;
let activeView = "dashboard";
let signedInEmail = "";
let adminSessionToken = "";
let authenticatedWorkerEndpoint = "";

function message(target, text, type = "") {
  target.textContent = text;
  target.className = `admin-message${type ? ` ${type}` : ""}`;
}

function readLocalJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

async function getConfiguredWorkerEndpoint() {
  const response = await fetch("data/config.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("Could not load the admin service configuration.");
  const settings = await response.json();
  if (typeof settings.order_endpoint !== "string" || !settings.order_endpoint) throw new Error("The admin service endpoint is not configured.");
  return settings.order_endpoint;
}

async function signIn(email, password) {
  const endpoint = await getConfiguredWorkerEndpoint();
  const response = await fetch(new URL("/admin/login", endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.sessionToken) throw new Error(result.error || "Email or password is incorrect.");
  adminSessionToken = result.sessionToken;
  signedInEmail = result.email;
  authenticatedWorkerEndpoint = endpoint;
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    email: result.email,
    token: result.sessionToken,
    workerEndpoint: endpoint,
    expiresAt: Date.now() + Number(result.expiresIn || 0) * 1000
  }));
  return result;
}

async function validateSession(session) {
  if (!session?.token || !session.workerEndpoint || Number(session.expiresAt) <= Date.now()) return false;
  const response = await fetch(new URL("/admin/session", session.workerEndpoint), {
    headers: { Authorization: `Bearer ${session.token}` }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.email) return false;
  adminSessionToken = session.token;
  signedInEmail = result.email;
  authenticatedWorkerEndpoint = session.workerEndpoint;
  return true;
}

function showConnectionStage() {
  $("#login-panel").hidden = true;
  $("#connection-panel").hidden = false;
  $("#admin-shell").classList.remove("auth-locked");
}

function fillConnectionForm(saved) {
  $("#repository").value = saved.repository || "";
  $("#branch").value = saved.branch || "main";
  $("#github-token").value = saved.githubToken || "";
  $("#worker-endpoint").value = saved.workerEndpoint || "";
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeBase64(text) {
  const bytes = Uint8Array.from(atob(text.replace(/\s/g, "")), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function githubFileUrl(path) {
  const [owner, repo] = repository.split("/");
  return `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `GitHub API error (${response.status}).`);
  return body;
}

async function readGitHubFile(path) {
  const file = await githubRequest(`${githubFileUrl(path)}?ref=${encodeURIComponent(branch)}`);
  if (file.encoding !== "base64" || !file.content) throw new Error(`Could not read ${path} from GitHub.`);
  fileShas[path] = file.sha;
  return JSON.parse(decodeBase64(file.content));
}

async function saveGitHubFile(path, value, summary) {
  const saved = await githubRequest(githubFileUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: summary,
      content: encodeBase64(`${JSON.stringify(value, null, 2)}\n`),
      sha: fileShas[path],
      branch
    })
  });
  if (!saved.content?.sha) throw new Error(`GitHub did not confirm saving ${path}.`);
  fileShas[path] = saved.content.sha;
}

function workerUrl(path) {
  return new URL(path, workerEndpoint).toString();
}

async function workerRequest(path, options = {}) {
  const response = await fetch(workerUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminSessionToken}`,
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Order service error (${response.status}).`);
  return body;
}

function navigate(viewName) {
  activeView = viewName;
  if (viewName !== "products") editor.hidden = true;
  views.forEach((view) => view.classList.toggle("active", view.dataset.panel === viewName));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  const titles = { dashboard: "Dashboard", products: "Product List", categories: "Categories", orders: "Sales / Orders", analytics: "Analytics", settings: "Settings" };
  $("#view-title").textContent = titles[viewName] || "Dashboard";
  if (viewName === "orders" || viewName === "dashboard" || viewName === "analytics") refreshOrders();
  if (viewName === "categories") renderCategories();
  if (viewName === "settings") fillSettings();
  $("#admin-workspace").scrollIntoView({ block: "start", behavior: "smooth" });
  $(".admin-shell").classList.remove("menu-open");
}

function normalizedProduct(product) {
  const images = Array.isArray(product.images) ? product.images : [product.image].filter(Boolean);
  return {
    ...product,
    category: String(product.category || "Uncategorized"),
    stock: Number.isInteger(product.stock) ? product.stock : 0,
    status: product.status === "draft" ? "draft" : "active",
    images,
    image: images[0] || product.image || "",
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    colors: Array.isArray(product.colors) ? product.colors : []
  };
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
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  filtered.slice(start, start + PAGE_SIZE).forEach((product) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const productInfo = document.createElement("div");
    productInfo.className = "table-product";
    const image = document.createElement("img");
    image.src = product.image;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.removeAttribute("src"), { once: true });
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = product.name;
    const id = document.createElement("small");
    id.textContent = product.id;
    info.append(name, id);
    productInfo.append(image, info);
    nameCell.append(productInfo);
    row.append(nameCell, cell(product.category), cell(`${product.price} MAD`), cell(String(product.stock)));
    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${product.status}`;
    badge.textContent = product.status === "active" ? "Active" : "Draft";
    statusCell.append(badge);
    row.append(statusCell);
    const actions = document.createElement("td");
    const actionGroup = document.createElement("div");
    actionGroup.className = "row-actions";
    const edit = button("Edit", () => editProduct(product.id));
    const remove = button("Delete", () => deleteProduct(product.id), "delete-action");
    actionGroup.append(edit, remove);
    actions.append(actionGroup);
    row.append(actions);
    tbody.append(row);
  });
  if (!filtered.length) tbody.append(emptyRow(6, "No products match your search."));
  $("#pagination-summary").textContent = filtered.length ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length}` : "No products";
  $("#page-number").textContent = `${currentPage} / ${pageCount}`;
  $("#page-previous").disabled = currentPage <= 1;
  $("#page-next").disabled = currentPage >= pageCount;
  updateCategoryFilter();
  updateProductStats();
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function button(text, action, className = "") {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = text;
  item.className = className;
  item.addEventListener("click", action);
  return item;
}

function emptyRow(span, text) {
  const row = document.createElement("tr");
  const td = cell(text);
  td.colSpan = span;
  row.append(td);
  return row;
}

function updateCategoryFilter() {
  const filter = $("#product-category-filter");
  const current = filter.value;
  const categories = [...new Set(products.map((item) => normalizedProduct(item).category))].sort();
  filter.replaceChildren(new Option("All categories", ""), ...categories.map((name) => new Option(name, name)));
  filter.value = categories.includes(current) ? current : "";
}

function updateProductStats() {
  $("#stat-products").textContent = String(products.length);
  $("#stat-active").textContent = String(products.filter((p) => normalizedProduct(p).status === "active").length);
}

function renderCategories() {
  const categoryMap = new Map();
  products.forEach((item) => {
    const product = normalizedProduct(item);
    categoryMap.set(product.category, (categoryMap.get(product.category) || 0) + 1);
  });
  const grid = $("#categories-grid");
  grid.replaceChildren();
  [...categoryMap.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([name, count]) => {
    const card = document.createElement("article");
    card.className = "category-card";
    const heading = document.createElement("strong");
    heading.textContent = name;
    const total = document.createElement("span");
    total.textContent = `${count} product${count === 1 ? "" : "s"}`;
    card.append(heading, total);
    grid.append(card);
  });
  if (!categoryMap.size) message($("#categories-message"), "Categories appear when you add products.");
  else message($("#categories-message"), "");
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
  productForm.reset();
  $("#product-id").value = "";
  $("#editor-title").textContent = "Add product";
  message($("#editor-message"), "");
}

function openNewProduct() {
  resetProductForm();
  editor.hidden = false;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product || !window.confirm(`Delete "${product.name}" from the catalog?`)) return;
  const previous = products;
  products = products.filter((item) => item.id !== id);
  try {
    await saveGitHubFile(PRODUCTS_PATH, products, `Delete product: ${product.name}`);
    renderProducts();
    message($("#products-message"), "Product deleted and saved to GitHub.", "success");
  } catch (error) {
    products = previous;
    renderProducts();
    message($("#products-message"), error.message, "error");
  }
}

function fillSettings() {
  $("#setting-store-name").value = config.store_name || "";
  $("#setting-announcement").value = config.announcement_text || "";
  $("#setting-primary-color").value = /^#[0-9a-f]{6}$/i.test(config.theme?.primary_color || "") ? config.theme.primary_color : "#2563eb";
  $("#setting-font").value = config.theme?.font_family || "system-ui, sans-serif";
  $("#setting-logo").value = config.logo_url || "";
  $("#setting-phone").value = config.store_phone || "";
  $("#setting-slides").value = JSON.stringify(config.slider_images || [], null, 2);
}

function renderOrders() {
  const statusFilter = $("#order-status-filter").value;
  const filtered = orders.filter((order) => !statusFilter || order.status === statusFilter);
  const tbody = $("#orders-table");
  tbody.replaceChildren();
  filtered.forEach((order) => {
    const row = document.createElement("tr");
    row.append(cell(order.id || ""), cell(order.name || ""), cell(`${order.phone || ""} / ${order.city || ""}`), cell(order.itemsSummary || order.product || ""), cell(`${order.total || order.price || 0} MAD`));
    const status = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${order.status || "new"}`;
    badge.textContent = order.status || "new";
    status.append(badge);
    row.append(status);
    const updateCell = document.createElement("td");
    const select = document.createElement("select");
    select.className = "order-status-select";
    ["new", "confirmed", "shipped", "delivered", "cancelled"].forEach((value) => select.add(new Option(value, value)));
    select.value = order.status || "new";
    select.addEventListener("change", () => updateOrderStatus(order.id, select.value, select));
    updateCell.append(select);
    row.append(updateCell);
    tbody.append(row);
  });
  if (!filtered.length) tbody.append(emptyRow(7, "No orders yet."));
  renderDashboardOrders();
  renderAnalytics();
}

async function refreshOrders() {
  if (!workerEndpoint || !adminSessionToken) return;
  message($("#orders-message"), "Loading orders...");
  try {
    const result = await workerRequest("/admin/orders");
    orders = Array.isArray(result.orders) ? result.orders : [];
    renderOrders();
    message($("#orders-message"), `${orders.length} orders loaded.`, "success");
  } catch (error) {
    message($("#orders-message"), error.message, "error");
  }
}

function renderDashboardOrders() {
  const tbody = $("#recent-orders");
  tbody.replaceChildren();
  orders.slice(0, 5).forEach((order) => {
    const row = document.createElement("tr");
    row.append(cell(order.id || ""), cell(order.name || ""), cell(order.itemsSummary || order.product || ""), cell(`${order.total || order.price || 0} MAD`));
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
  const completedOrders = orders.filter((order) => order.status !== "cancelled");
  const revenue = completedOrders.reduce((sum, order) => sum + Number(order.total || order.price || 0), 0);
  $("#stat-orders").textContent = String(orders.length);
  $("#stat-sales").textContent = `${revenue.toFixed(2)} MAD`;
  $("#analytics-orders").textContent = String(orders.length);
  $("#analytics-revenue").textContent = `${revenue.toFixed(2)} MAD`;
  $("#analytics-average").textContent = `${(completedOrders.length ? revenue / completedOrders.length : 0).toFixed(2)} MAD`;
  $("#analytics-pending").textContent = String(orders.filter((order) => ["new", "confirmed"].includes(order.status)).length);
  const sold = new Map();
  orders.filter((order) => order.status !== "cancelled").forEach((order) => {
    (order.items || []).forEach((item) => sold.set(item.name, (sold.get(item.name) || 0) + Number(item.quantity || 1)));
  });
  const list = $("#best-sellers");
  list.replaceChildren();
  [...sold.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([name, count]) => {
    const row = document.createElement("div");
    row.className = "best-seller-row";
    const productName = document.createElement("span");
    productName.textContent = name;
    const units = document.createElement("span");
    units.textContent = `${count} sold`;
    row.append(productName, units);
    list.append(row);
  });
  if (!sold.size) list.textContent = "Sales data will appear after orders arrive.";
}

async function updateOrderStatus(orderId, status, select) {
  select.disabled = true;
  try {
    await workerRequest("/admin/orders", { method: "PATCH", body: JSON.stringify({ orderId, status }) });
    const order = orders.find((item) => item.id === orderId);
    if (order) order.status = status;
    renderOrders();
    message($("#orders-message"), "Order status updated.", "success");
  } catch (error) {
    select.value = orders.find((item) => item.id === orderId)?.status || "new";
    message($("#orders-message"), error.message, "error");
  } finally {
    select.disabled = false;
  }
}

async function connectServices(credentials, remember = true) {
  repository = credentials.repository.trim();
  branch = credentials.branch.trim() || "main";
  githubToken = credentials.githubToken.trim();
  workerEndpoint = credentials.workerEndpoint.trim();
  const connectButton = $("#connect-button");
  connectButton.disabled = true;
  message($("#connection-message"), "Connecting to GitHub and the orders service...");
  try {
    if (new URL(workerEndpoint).origin !== new URL(authenticatedWorkerEndpoint).origin) {
      throw new Error("Use the Worker origin that issued this admin session.");
    }
    const [loadedProducts, loadedConfig, loadedOrders] = await Promise.all([
      readGitHubFile(PRODUCTS_PATH),
      readGitHubFile(CONFIG_PATH),
      workerRequest("/admin/orders")
    ]);
    if (!Array.isArray(loadedProducts) || !loadedConfig || typeof loadedConfig !== "object") throw new Error("Store data has an invalid format.");
    products = loadedProducts;
    config = loadedConfig;
    orders = Array.isArray(loadedOrders.orders) ? loadedOrders.orders : [];
    if (remember) {
      localStorage.setItem(CONNECTION_KEY, JSON.stringify({ repository, branch, githubToken, workerEndpoint }));
    }
    workspace.hidden = false;
    $("#connection-indicator").textContent = "Connected";
    $("#connection-indicator").classList.add("connected");
    $("#connection-panel").hidden = true;
    $("#logout-button").hidden = false;
    $("#github-token").value = "";
    renderProducts();
    renderOrders();
    message($("#connection-message"), "Connected successfully.", "success");
    navigate("dashboard");
  } catch (error) {
    githubToken = "";
    message($("#connection-message"), error.message, "error");
  } finally {
    connectButton.disabled = false;
  }
}

connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const credentials = {
    repository: $("#repository").value.trim(),
    branch: $("#branch").value.trim() || "main",
    githubToken: $("#github-token").value.trim(),
    workerEndpoint: $("#worker-endpoint").value.trim()
  };
  if (!/^[^/\s]+\/[^/\s]+$/.test(credentials.repository)) {
    message($("#connection-message"), "Use the owner/repository format.", "error");
    return;
  }
  connectServices(credentials);
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#login-email").value.trim().toLowerCase();
  const password = $("#login-password").value;
  const loginButton = $("#login-button");
  loginButton.disabled = true;
  message($("#login-message"), "Verifying account...");
  try {
    await signIn(email, password);
    $("#login-form").reset();
    showConnectionStage();
    message($("#connection-message"), "Sign-in complete. Connect your services to continue.");
    const savedConnection = readLocalJson(CONNECTION_KEY);
    if (savedConnection) {
      fillConnectionForm(savedConnection);
      await connectServices(savedConnection, false);
    }
  } catch (error) {
    message($("#login-message"), error.message || "Could not verify the account.", "error");
  } finally {
    loginButton.disabled = false;
  }
});

$("#logout-button").addEventListener("click", () => {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(CONNECTION_KEY);
  localStorage.removeItem("mougamarket-admin-account");
  githubToken = "";
  adminSessionToken = "";
  authenticatedWorkerEndpoint = "";
  repository = "";
  branch = "main";
  workerEndpoint = "";
  signedInEmail = "";
  products = [];
  config = {};
  orders = [];
  fileShas = {};
  connectionForm.reset();
  workspace.hidden = true;
  $("#logout-button").hidden = true;
  $("#connection-indicator").textContent = "Not connected";
  $("#connection-indicator").classList.remove("connected");
  $("#connection-panel").hidden = true;
  $("#login-panel").hidden = false;
  $("#admin-shell").classList.add("auth-locked");
  message($("#login-message"), "You have been logged out.");
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const oldId = $("#product-id").value;
  const name = $("#product-name").value.trim();
  const category = $("#product-category").value.trim();
  const price = Number($("#product-price").value);
  const stock = Number($("#product-stock").value);
  const images = $("#product-images").value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const description = $("#product-description").value.trim();
  if (!name || !category || !description || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0 || !images.length) {
    message($("#editor-message"), "Check the required fields, price, stock and at least one image.", "error");
    return;
  }
  if (images.some((value) => {
    try { return !["https:", "http:"].includes(new URL(value).protocol); } catch { return true; }
  })) {
    message($("#editor-message"), "Each image must use an http:// or https:// URL.", "error");
    return;
  }
  const id = oldId || `product-${crypto.randomUUID()}`;
  const product = {
    id, name, category, price, stock, status: $("#product-status").value,
    badge: $("#product-badge").value.trim(),
    sizes: $("#product-sizes").value.split(",").map((value) => value.trim()).filter(Boolean),
    colors: $("#product-colors").value.split(",").map((value) => value.trim()).filter(Boolean),
    images, image: images[0], description
  };
  const oldProducts = products;
  products = oldId ? products.map((item) => item.id === oldId ? product : item) : [...products, product];
  $("#save-product").disabled = true;
  message($("#editor-message"), "Saving product to GitHub...");
  try {
    await saveGitHubFile(PRODUCTS_PATH, products, `${oldId ? "Update" : "Add"} product: ${name}`);
    renderProducts();
    renderCategories();
    editor.hidden = true;
    resetProductForm();
    message($("#products-message"), "Product saved. GitHub Pages will update shortly.", "success");
  } catch (error) {
    products = oldProducts;
    renderProducts();
    message($("#editor-message"), error.message, "error");
  } finally {
    $("#save-product").disabled = false;
  }
});

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  let slides;
  try {
    slides = JSON.parse($("#setting-slides").value || "[]");
    if (!Array.isArray(slides) || slides.some((slide) => !slide || typeof slide !== "object" || Array.isArray(slide))) throw new Error();
  } catch {
    message($("#settings-message"), "Slides must be a valid JSON array of objects.", "error");
    return;
  }
  const logo = $("#setting-logo").value.trim();
  if (logo && !/^https?:\/\//i.test(logo)) {
    message($("#settings-message"), "Logo URL must start with https:// or http://.", "error");
    return;
  }
  const previous = config;
  config = {
    ...config,
    store_name: $("#setting-store-name").value.trim(),
    announcement_text: $("#setting-announcement").value.trim(),
    store_phone: $("#setting-phone").value.trim(),
    logo_url: logo,
    theme: {
      ...(config.theme || {}),
      primary_color: $("#setting-primary-color").value,
      font_family: $("#setting-font").value.trim() || "system-ui, sans-serif"
    },
    slider_images: slides
  };
  $("#save-settings").disabled = true;
  message($("#settings-message"), "Saving settings to GitHub...");
  try {
    await saveGitHubFile(CONFIG_PATH, config, "Update storefront settings");
    document.documentElement.style.setProperty("--green", config.theme.primary_color);
    message($("#settings-message"), "Settings saved to GitHub.", "success");
  } catch (error) {
    config = previous;
    message($("#settings-message"), error.message, "error");
  } finally {
    $("#save-settings").disabled = false;
  }
});

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
document.querySelectorAll("[data-open-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.openView)));
$("#new-product").addEventListener("click", openNewProduct);
$("#close-editor").addEventListener("click", () => { editor.hidden = true; });
$("#cancel-edit").addEventListener("click", () => { editor.hidden = true; resetProductForm(); });
$("#product-search").addEventListener("input", () => { currentPage = 1; renderProducts(); });
$("#product-category-filter").addEventListener("change", () => { currentPage = 1; renderProducts(); });
$("#page-previous").addEventListener("click", () => { currentPage = Math.max(1, currentPage - 1); renderProducts(); });
$("#page-next").addEventListener("click", () => { currentPage += 1; renderProducts(); });
$("#order-status-filter").addEventListener("change", renderOrders);
$("#refresh-orders").addEventListener("click", refreshOrders);
$("#mobile-menu").addEventListener("click", () => $(".admin-shell").classList.toggle("menu-open"));
window.addEventListener("pagehide", () => { githubToken = ""; adminSessionToken = ""; });

async function initializeAdminAccess() {
  const session = readLocalJson(SESSION_KEY);
  if (!session) return;
  try {
    if (!await validateSession(session)) throw new Error("Session expired.");
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  showConnectionStage();
  const savedConnection = readLocalJson(CONNECTION_KEY);
  if (!savedConnection) return;
  fillConnectionForm(savedConnection);
  await connectServices(savedConnection, false);
}

initializeAdminAccess();
window.addEventListener("pageshow", (event) => {
  if (event.persisted) initializeAdminAccess();
});
