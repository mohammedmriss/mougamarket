const $ = (selector) => document.querySelector(selector);
const CART_KEY = "mougamarket-bag";
let product;
let config = {};
let selectedSize = "";
let selectedColor = "";
let checkoutItems = [];
let clearCartAfterCheckout = false;

function formatMoney(value) {
  return `${new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 2 }).format(value)} درهم`;
}
function setTheme(settings) {
  if (/^#[0-9a-f]{6}$/i.test(settings.theme?.primary_color || "")) {
    document.documentElement.style.setProperty("--blue", settings.theme.primary_color);
  }
  if (typeof settings.theme?.font_family === "string") document.documentElement.style.fontFamily = settings.theme.font_family;
  if (settings.store_name) {
    $("#store-name").textContent = settings.store_name;
    $("#footer-store-name").textContent = settings.store_name;
    document.title = `${product?.name || "المنتج"} | ${settings.store_name}`;
    document.querySelectorAll('meta[property^="og:"]').forEach((meta) => { meta.content = meta.content.replace(/MougaMarket/g, settings.store_name); });
  }
  if (settings.announcement_text) {
    $("#announcement").textContent = settings.announcement_text;
    $("#announcement").hidden = false;
  }
  if (settings.store_phone) {
    const phoneLink = $("#topbar-phone");
    phoneLink.href = `tel:${settings.store_phone.replace(/[^\d+]/g, "")}`;
    phoneLink.textContent = settings.store_phone;
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
    button.setAttribute("aria-label", `عرض الصورة ${index + 1}`);
    button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
    const image = new Image();
    image.src = src;
    image.alt = "";
    image.loading = index ? "lazy" : "eager";
    image.addEventListener("error", () => {
      button.classList.add("image-unavailable");
      image.removeAttribute("src");
      image.alt = "الصورة غير متوفرة";
    }, { once: true });
    button.append(image);
    button.addEventListener("click", () => {
      $("#featured-image").src = src;
      thumbs.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    });
    thumbs.append(button);
  });
  $("#featured-image").src = safeImages[0];
  $("#featured-image").alt = product.name;
  $("#featured-image").loading = "eager";
  $("#featured-image").addEventListener("error", () => {
    $("#featured-image").removeAttribute("src");
    $("#featured-image").alt = "الصورة غير متوفرة";
    $("#featured-image").parentElement.classList.add("image-unavailable");
  }, { once: true });
}

function renderOptions(container, group, values, onSelect, selectFirst = false) {
  group.hidden = !values.length;
  container.replaceChildren();
  if (!values.length) onSelect("");
  values.forEach((value, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "variant-option";
    option.textContent = value;
    option.setAttribute("aria-pressed", String(selectFirst && index === 0));
    option.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === option)));
      onSelect(value);
      updatePurchaseAvailability();
    });
    container.append(option);
  });
  if (selectFirst && values.length) onSelect(values[0]);
  updatePurchaseAvailability();
}

function updatePurchaseAvailability() {
  const unavailable = Number(product?.stock) <= 0;
  const needsChoice = Boolean((product?.sizes?.length && !selectedSize) || (product?.colors?.length && !selectedColor));
  $("#add-to-bag").disabled = unavailable || needsChoice;
  $("#buy-now").disabled = unavailable || needsChoice;
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
    image.addEventListener("error", () => {
      image.removeAttribute("src");
      image.alt = "الصورة غير متوفرة";
      anchor.classList.add("image-unavailable");
    }, { once: true });
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
  if (Number(product.stock) <= 0 || !hasRequiredOptions()) return;
  const cart = getCart();
  const variantKey = `${selectedSize}|${selectedColor}`;
  const existing = cart.find((item) => item.id === product.id && `${item.size || ""}|${item.color || ""}` === variantKey);
  if (existing) existing.quantity += 1;
  else cart.push(cartItem());
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateBagCount();
  $("#purchase-feedback").textContent = "تزاد المنتج للسلة.";
}

function hasRequiredOptions() {
  return (!product.sizes?.length || Boolean(selectedSize)) && (!product.colors?.length || Boolean(selectedColor));
}

function openCheckout(items, clearCart = false) {
  checkoutItems = items;
  clearCartAfterCheckout = clearCart;
  renderCartDialog(items, clearCart);
  const total = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);
  $("#checkout-summary").textContent = `${items.reduce((sum, item) => sum + Number(item.quantity || 1), 0)} منتجات · ${formatMoney(total)}`;
  $("#checkout-message").textContent = "";
  $("#checkout-message").className = "form-message";
  $("#checkout-form").reset();
  $("#checkout-dialog").showModal();
  window.trackStoreEvent?.(config.facebook_pixel_id, "Lead", { content_name: product?.name || "Shopping cart" });
}

function renderCartDialog(items, isCart) {
  const container = $("#cart-items");
  const totalLabel = $("#cart-total");
  container.replaceChildren();
  container.hidden = !isCart;
  totalLabel.hidden = !isCart;
  const total = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);
  totalLabel.textContent = `المجموع: ${formatMoney(total)}`;
  if (!isCart) return;
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "cart-line";
    const label = document.createElement("span");
    label.className = "cart-line-name";
    label.textContent = `${item.name}${item.size ? ` · ${item.size}` : ""}${item.color ? ` · ${item.color}` : ""}`;
    const qty = document.createElement("span");
    qty.className = "cart-line-quantity";
    qty.textContent = String(item.quantity);
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "cart-quantity-button";
    minus.textContent = "−";
    minus.setAttribute("aria-label", `نقص الكمية من ${item.name}`);
    minus.addEventListener("click", () => changeCartQuantity(index, -1));
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "cart-quantity-button";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `زيد الكمية من ${item.name}`);
    plus.addEventListener("click", () => changeCartQuantity(index, 1));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cart-remove-button";
    remove.textContent = "حيد";
    remove.addEventListener("click", () => removeCartItem(index));
    row.append(label, minus, qty, plus, remove);
    container.append(row);
  });
}

function changeCartQuantity(index, delta) {
  const cart = getCart();
  if (!cart[index]) return;
  const stock = Number((window.productCatalog || []).find((item) => item.id === cart[index].id)?.stock ?? (product.id === cart[index].id ? product.stock : 20));
  cart[index].quantity = Math.min(stock, Number(cart[index].quantity || 1) + delta);
  if (cart[index].quantity < 1) cart.splice(index, 1);
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateBagCount();
  checkoutItems = cart;
  renderCartDialog(cart, true);
  $("#checkout-summary").textContent = `${cart.length} منتجات · ${formatMoney(cart.reduce((sum, item) => sum + item.price * item.quantity, 0))}`;
  if (!cart.length) $("#checkout-message").textContent = "السلة ولات فارغة.";
}

function removeCartItem(index) {
  const cart = getCart();
  cart.splice(index, 1);
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateBagCount();
  checkoutItems = cart;
  renderCartDialog(cart, true);
  if (!cart.length) $("#checkout-message").textContent = "السلة ولات فارغة.";
}

function normalizePhone(value) {
  const phone = value.replace(/[\s()-]/g, "");
  if (!/^(?:\+212|0)[5-7]\d{8}$/.test(phone)) return null;
  return phone.startsWith("0") ? `+212${phone.slice(1)}` : phone;
}

async function submitCheckout(event) {
  event.preventDefault();
  if (!checkoutItems.length) {
    $("#checkout-message").textContent = "السلة فارغة، زيد شي منتج قبل ما تصيفط الطلب.";
    return;
  }
  const form = new FormData(event.currentTarget);
  if (form.get("website")) return;
  const phone = normalizePhone(String(form.get("phone") || "").trim());
  if (!phone) {
    $("#checkout-message").textContent = "دخل رقم هاتف مغربي صحيح (مثال: 0612345678).";
    return;
  }
  if (!config.order_endpoint) {
    $("#checkout-message").textContent = "خدمة الطلبات مازال ما تفعّلاتش. عاود المحاولة من بعد.";
    return;
  }
  const submit = $("#submit-checkout");
  submit.disabled = true;
  submit.textContent = "كنصيفطو الطلب...";
  try {
    const total = checkoutItems.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);
    const response = await fetch(new URL("/orders", config.order_endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") || "").trim(),
        phone,
        address: String(form.get("address") || "").trim(),
        items: checkoutItems,
        total,
        website: ""
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "ما قدرناش نصيفطو الطلب. عاود المحاولة من بعد.");
    if (clearCartAfterCheckout) {
      localStorage.removeItem(CART_KEY);
      updateBagCount();
    }
    $("#checkout-message").textContent = "وصلنا الطلب ديالك، غادي نتاصلو بيك باش نأكدو.";
    $("#checkout-message").classList.add("success");
    window.trackStoreEvent?.(config.facebook_pixel_id, "Purchase", { value: total, currency: "MAD" });
    window.setTimeout(() => $("#checkout-dialog").close(), 2200);
  } catch (error) {
    $("#checkout-message").textContent = error instanceof TypeError
      ? "تعذر الاتصال بخدمة الطلبات. تأكد من الإنترنت وعاود المحاولة."
      : error instanceof Error ? error.message : "وقع مشكل فإرسال الطلب. عاود المحاولة.";
  } finally {
    submit.disabled = false;
    submit.textContent = "صيفط الطلب";
  }
}

async function initialize() {
  $("#year").textContent = String(new Date().getFullYear());
  updateBagCount();
  $("#bag-button").addEventListener("click", () => {
    const bag = getCart();
    if (!bag.length) {
      $("#purchase-feedback").textContent = "السلة فارغة.";
      return;
    }
    openCheckout(bag, true);
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
    if (!productsResponse.ok || !configResponse.ok) throw new Error("ما قدرناش نحملو بيانات المتجر.");
    const [products, settings] = await Promise.all([productsResponse.json(), configResponse.json()]);
    if (!Array.isArray(products)) throw new Error("ملف المنتجات فيه صيغة غير صحيحة.");
    const id = new URLSearchParams(location.search).get("id");
    product = products.find((item) => item.id === id && item.status !== "draft") || (!id ? products.find((item) => item.status !== "draft") : null);
    if (!product) throw new Error("هاد المنتج ما بقاش متوفر.");
    config = settings;
    window.productCatalog = products;
    setTheme(settings);
    if (settings.store_phone) {
      const phone = settings.store_phone;
      $("#topbar-phone").href = `tel:${phone.replace(/[^\d+]/g, "")}`;
      $("#topbar-phone").textContent = phone;
    }
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
    $("#detail-stock").textContent = stock > 0 ? `متوفر (${stock})` : "غير متوفر";
    $("#detail-stock").classList.toggle("out-of-stock", stock <= 0);
    $("#add-to-bag").disabled = stock <= 0;
    $("#buy-now").disabled = stock <= 0;
    renderGallery(images);
    renderOptions($("#size-options"), $("#size-group"), product.sizes || [], (value) => { selectedSize = value; });
    renderOptions($("#color-options"), $("#color-group"), product.colors || [], (value) => { selectedColor = value; }, true);
    renderRecommendations(products.filter((item) => item.status !== "draft"));
    document.title = `${product.name} | ${settings.store_name || "MougaMarket"}`;
    const pageUrl = `https://mougamarket.store/product.html?id=${encodeURIComponent(product.id)}`;
    const description = product.description || `تسوق ${product.name} من MougaMarket مع التوصيل لجميع المدن المغربية والدفع عند الاستلام.`;
    document.querySelector('link[rel="canonical"]').href = pageUrl;
    document.querySelector('meta[name="description"]').content = description;
    document.querySelector('meta[property="og:title"]').content = `${product.name} | ${settings.store_name || "MougaMarket"}`;
    document.querySelector('meta[property="og:description"]').content = description;
    document.querySelector('meta[property="og:url"]').content = pageUrl;
    const imageUrl = images[0] ? new URL(images[0], location.href).href : "";
    if (imageUrl) {
      const imageMeta = document.createElement("meta");
      imageMeta.setAttribute("property", "og:image");
      imageMeta.content = imageUrl;
      document.head.append(imageMeta);
    }
    const schema = document.createElement("script");
    schema.type = "application/ld+json";
    schema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      description,
      sku: String(product.id),
      ...(imageUrl ? { image: imageUrl } : {}),
      ...(product.category ? { category: product.category } : {}),
      brand: { "@type": "Brand", name: settings.store_name || "MougaMarket" },
      offers: {
        "@type": "Offer",
        url: pageUrl,
        priceCurrency: "MAD",
        price: Number(product.price).toFixed(2),
        availability: Number(product.stock ?? 1) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
      }
    });
    document.head.append(schema);
  } catch (error) {
    $("#product-status").textContent = error.message;
    $("#product-status").classList.add("error");
  }
}

initialize();
