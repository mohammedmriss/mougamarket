const $ = (selector) => document.querySelector(selector);
const CART_KEY = "mougamarket-bag";
let product;
let config = {};
let selectedSize = "";
let selectedColor = "";
let checkoutItems = [];

function formatMoney(value) {
  return `${new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 2 }).format(value)} MAD`;
}

function setTheme(settings) {
  if (/^#[0-9a-f]{6}$/i.test(settings.theme?.primary_color || "")) {
    document.documentElement.style.setProperty("--green", settings.theme.primary_color);
  }
  if (typeof settings.theme?.font_family === "string") document.documentElement.style.fontFamily = settings.theme.font_family;
  if (settings.store_name) {
    $("#store-name").textContent = settings.store_name;
    $("#footer-store-name").textContent = settings.store_name;
    document.title = `${settings.store_name} | ${product?.name || "Product"}`;
  }
  if (settings.announcement_text) {
    $("#announcement").textContent = settings.announcement_text;
    $("#announcement").hidden = false;
  }
  if (settings.logo_url) {
    const mark = document.querySelector(".product-page .brand-mark");
    const logo = new Image();
    logo.src = settings.logo_url;
    logo.alt = "";
    logo.className = "store-logo";
    mark.replaceWith(logo);
  }
}

function getCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function updateBagCount() {
  $("#bag-count").textContent = String(getCart().reduce((sum, item) => sum + Number(item.quantity || 0), 0));
}

function renderGallery(images) {
  const thumbs = $("#gallery-thumbnails");
  thumbs.replaceChildren();
  const safeImages = images.length ? images : [""];
  safeImages.forEach((src, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-thumbnail";
    button.setAttribute("aria-label", `View image ${index + 1}`);
    button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
    const image = new Image();
    image.src = src;
    image.alt = "";
    image.loading = index ? "lazy" : "eager";
    button.append(image);
    button.addEventListener("click", () => {
      $("#featured-image").src = src;
      thumbs.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    });
    thumbs.append(button);
  });
  $("#featured-image").src = safeImages[0];
  $("#featured-image").alt = product.name;
}

function renderOptions(container, group, values, onSelect) {
  group.hidden = !values.length;
  container.replaceChildren();
  values.forEach((value, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "variant-option";
    option.textContent = value;
    option.setAttribute("aria-pressed", String(index === 0));
    option.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === option)));
      onSelect(value);
    });
    container.append(option);
    if (index === 0) onSelect(value);
  });
}

function renderRecommendations(products) {
  const recommended = products.filter((item) => item.id !== product.id && item.status !== "draft").slice(0, 3);
  const grid = $("#recommendation-grid");
  recommended.forEach((item) => {
    const anchor = document.createElement("a");
    anchor.className = "recommendation-card";
    anchor.href = `product.html?id=${encodeURIComponent(item.id)}`;
    const image = new Image();
    image.src = (item.images?.[0] || item.image || "");
    image.alt = item.name;
    image.loading = "lazy";
    const content = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = item.name;
    const price = document.createElement("p");
    price.textContent = formatMoney(item.price);
    content.append(name, price);
    anchor.append(image, content);
    grid.append(anchor);
  });
  $("#recommendations").hidden = recommended.length === 0;
}

function cartItem() {
  return { id: product.id, name: product.name, price: product.price, quantity: 1, size: selectedSize, color: selectedColor };
}

function addToBag() {
  if (Number(product.stock) <= 0) return;
  const cart = getCart();
  const variantKey = `${selectedSize}|${selectedColor}`;
  const existing = cart.find((item) => item.id === product.id && `${item.size || ""}|${item.color || ""}` === variantKey);
  if (existing) existing.quantity += 1;
  else cart.push(cartItem());
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateBagCount();
  $("#purchase-feedback").textContent = "Added to your bag.";
}

function openCheckout(items) {
  checkoutItems = items;
  const total = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);
  $("#checkout-summary").textContent = `${items.reduce((sum, item) => sum + Number(item.quantity || 1), 0)} item(s) · ${formatMoney(total)}`;
  $("#checkout-message").textContent = "";
  $("#checkout-message").className = "form-message";
  $("#checkout-form").reset();
  $("#checkout-dialog").showModal();
}

function normalizePhone(value) {
  const phone = value.replace(/[\s()-]/g, "");
  if (!/^(?:\+212|0)[5-7]\d{8}$/.test(phone)) return null;
  return phone.startsWith("0") ? `+212${phone.slice(1)}` : phone;
}

async function submitCheckout(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  if (form.get("website")) return;
  const phone = normalizePhone(String(form.get("phone") || "").trim());
  if (!phone) {
    $("#checkout-message").textContent = "Enter a valid Moroccan phone number.";
    return;
  }
  if (!config.order_endpoint) {
    $("#checkout-message").textContent = "Checkout is not configured yet. Please try again later.";
    return;
  }
  const submit = $("#submit-checkout");
  submit.disabled = true;
  submit.textContent = "Sending...";
  try {
    const total = checkoutItems.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);
    const response = await fetch(new URL("/orders", config.order_endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") || "").trim(),
        phone,
        city: String(form.get("city") || "").trim(),
        items: checkoutItems,
        total,
        website: ""
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not submit the order.");
    localStorage.removeItem(CART_KEY);
    updateBagCount();
    $("#checkout-message").textContent = "Order received. We will call to confirm it.";
    $("#checkout-message").classList.add("success");
    window.setTimeout(() => $("#checkout-dialog").close(), 2200);
  } catch (error) {
    $("#checkout-message").textContent = error.message || "Connection error. Please try again.";
  } finally {
    submit.disabled = false;
    submit.textContent = "Place order";
  }
}

async function initialize() {
  $("#year").textContent = String(new Date().getFullYear());
  updateBagCount();
  $("#bag-button").addEventListener("click", () => {
    const bag = getCart();
    if (!bag.length) {
      $("#purchase-feedback").textContent = "Your bag is empty.";
      return;
    }
    openCheckout(bag);
  });
  $("#add-to-bag").addEventListener("click", addToBag);
  $("#buy-now").addEventListener("click", () => openCheckout([cartItem()]));
  $("#close-checkout").addEventListener("click", () => $("#checkout-dialog").close());
  $("#checkout-dialog").addEventListener("click", (event) => {
    if (event.target === $("#checkout-dialog")) $("#checkout-dialog").close();
  });
  $("#checkout-form").addEventListener("submit", submitCheckout);
  try {
    const [productsResponse, configResponse] = await Promise.all([
      fetch("data/products.json", { cache: "no-cache" }),
      fetch("data/config.json", { cache: "no-cache" })
    ]);
    if (!productsResponse.ok || !configResponse.ok) throw new Error("Could not load store data.");
    const [products, settings] = await Promise.all([productsResponse.json(), configResponse.json()]);
    if (!Array.isArray(products)) throw new Error("Product catalog is invalid.");
    const id = new URLSearchParams(location.search).get("id");
    product = products.find((item) => item.id === id && item.status !== "draft") || (!id ? products.find((item) => item.status !== "draft") : null);
    if (!product) throw new Error("This product is not available.");
    config = settings;
    setTheme(settings);
    const images = Array.isArray(product.images) ? product.images : [product.image].filter(Boolean);
    $("#product-detail").hidden = false;
    $("#product-status").textContent = "";
    $("#breadcrumb-name").textContent = product.name;
    $("#detail-name").textContent = product.name;
    $("#detail-category").textContent = product.category || "";
    $("#detail-price").textContent = formatMoney(product.price);
    $("#detail-description").textContent = product.description || "";
    $("#detail-badge").textContent = product.badge || "";
    $("#detail-badge").hidden = !product.badge;
    $("#gallery-badge").textContent = product.badge || "";
    $("#gallery-badge").hidden = !product.badge;
    const stock = Number(product.stock ?? 1);
    $("#detail-stock").textContent = stock > 0 ? `${stock} available` : "Out of stock";
    $("#detail-stock").classList.toggle("out-of-stock", stock <= 0);
    $("#add-to-bag").disabled = stock <= 0;
    $("#buy-now").disabled = stock <= 0;
    renderGallery(images);
    renderOptions($("#size-options"), $("#size-group"), product.sizes || [], (value) => { selectedSize = value; });
    renderOptions($("#color-options"), $("#color-group"), product.colors || [], (value) => { selectedColor = value; });
    renderRecommendations(products.filter((item) => item.status !== "draft"));
    document.title = `${product.name} | ${settings.store_name || "MougaMarket"}`;
  } catch (error) {
    $("#product-status").textContent = error.message;
    $("#product-status").classList.add("error");
  }
}

initialize();
