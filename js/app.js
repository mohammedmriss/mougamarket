const productsGrid = document.querySelector("#products-grid");
const productsStatus = document.querySelector("#products-status");
const orderDialog = document.querySelector("#order-dialog");
const orderForm = document.querySelector("#order-form");
const orderMessage = document.querySelector("#order-message");
const submitOrderButton = document.querySelector("#submit-order");

let activeProduct = null;
let storeConfig = {};
let slides = [];
let currentSlide = 0;
let slideTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderProducts(products) {
  productsGrid.replaceChildren();
  products.forEach((product) => {
    if (product.status === "draft") return;
    const card = element("article", "product-card");
    const imageWrap = element("div", "product-image-wrap");
    const imageLink = element("a", "product-image-link");
    imageLink.href = `product.html?id=${encodeURIComponent(product.id)}`;
    const image = element("img", "product-image");
    image.src = product.images?.[0] || product.image;
    image.alt = product.name;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      image.removeAttribute("src");
      image.alt = "الصورة غير متوفرة";
      imageWrap.classList.add("image-unavailable");
    }, { once: true });
    imageLink.append(image);
    imageWrap.append(imageLink);

    const content = element("div", "product-content");
    const title = element("h3");
    const titleLink = element("a", "", product.name);
    titleLink.href = `product.html?id=${encodeURIComponent(product.id)}`;
    title.append(titleLink);
    content.append(title);
    if (product.category) content.append(element("p", "product-category-label", product.category));
    content.append(element("p", "product-description", product.description));
    const footer = element("div", "product-footer");
    const price = element("span", "price");
    price.append(
      document.createTextNode(new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 2 }).format(product.price)),
      element("small", "", " درهم")
    );
    const orderButton = element("button", "button button-primary order-button", "اطلب الآن");
    orderButton.type = "button";
    orderButton.disabled = Number(product.stock ?? 1) <= 0;
    if (orderButton.disabled) orderButton.textContent = "غير متوفر";
    orderButton.addEventListener("click", () => openOrderDialog(product));
    footer.append(price, orderButton);
    content.append(footer);
    card.append(imageWrap, content);
    productsGrid.append(card);
  });
}

function openOrderDialog(product) {
  activeProduct = product;
  document.querySelector("#selected-product").textContent =
    `${product.name} — ${new Intl.NumberFormat("fr-MA").format(product.price)} درهم`;
  orderMessage.textContent = "";
  orderMessage.className = "form-message";
  orderForm.reset();
  orderDialog.showModal();
  document.querySelector("#customer-name").focus();
}

function normalizeMoroccanPhone(phone) {
  const cleaned = phone.replace(/[\s()-]/g, "");
  if (!/^(?:\+212|0)[5-7]\d{8}$/.test(cleaned)) return null;
  return cleaned.startsWith("0") ? `+212${cleaned.slice(1)}` : cleaned;
}

async function submitOrder(event) {
  event.preventDefault();
  if (!activeProduct) {
    orderMessage.textContent = "اختار منتوج قبل ما تصيفط الطلب.";
    return;
  }
  const formData = new FormData(orderForm);
  if (formData.get("website")) return;
  const phone = normalizeMoroccanPhone(String(formData.get("phone") || "").trim());
  if (!phone) {
    orderMessage.textContent = "دخل رقم هاتف مغربي صحيح (مثال: 0612345678).";
    return;
  }
  const endpoint = storeConfig.order_endpoint;
  if (!endpoint) {
    orderMessage.textContent = "خدمة الطلبات مازال ما تفعّلاتش. عاود المحاولة من بعد.";
    return;
  }

  submitOrderButton.disabled = true;
  submitOrderButton.textContent = "كنصيفطو الطلب...";
  orderMessage.textContent = "";
  try {
    const response = await fetch(new URL("/orders", endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(formData.get("name") || "").trim(),
        phone,
        city: String(formData.get("city") || "").trim(),
        items: [{ id: activeProduct.id, name: activeProduct.name, price: activeProduct.price, quantity: 1 }],
        total: activeProduct.price,
        website: ""
      })
    });
    if (!response.ok) throw new Error("تعذر إرسال الطلب. عاود المحاولة من بعد.");
    orderMessage.textContent = "وصلنا الطلب ديالك، غادي نتاصلو بيك باش نأكدو.";
    orderMessage.classList.add("success");
    orderForm.reset();
    window.setTimeout(() => orderDialog.close(), 2200);
  } catch (error) {
    orderMessage.textContent = error.message || "وقع مشكل فالإرسال. تأكد من الاتصال بالإنترنت.";
  } finally {
    submitOrderButton.disabled = false;
    submitOrderButton.textContent = "صيفط الطلب";
  }
}

function setSlide(index) {
  if (!slides.length) return;
  currentSlide = (index + slides.length) % slides.length;
  const slide = slides[currentSlide];
  const hero = document.querySelector(".hero");
  document.querySelector("#hero-title").textContent = slide.title || "منتجات مميزة، تجربة تسوق سهلة.";
  document.querySelector("#hero-description").textContent =
    slide.description || "تسوق من دارك، والتوصيل حتى لباب دارك فين ما كنتي فالمغرب.";
  if (slide.image) {
    hero.classList.add("has-image");
    hero.style.backgroundImage = `url("${slide.image.replaceAll('"', "%22")}")`;
  } else {
    hero.classList.remove("has-image");
    hero.style.backgroundImage = "";
  }
  document.querySelectorAll(".slider-dot").forEach((dot, dotIndex) => {
    dot.setAttribute("aria-current", dotIndex === currentSlide ? "true" : "false");
  });
}

function setupSlider(config) {
  slides = Array.isArray(config.slider_images) ? config.slider_images.map((slide) => (
    typeof slide === "string" ? { image: slide } : slide
  )).filter((slide) => slide && typeof slide === "object") : [];
  if (!slides.length) return;
  const controls = document.querySelector("#slider-controls");
  const dots = document.querySelector("#slider-dots");
  controls.hidden = slides.length < 2;
  slides.forEach((slide, index) => {
    const dot = element("button", "slider-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", `الإعلان ${index + 1}`);
    dot.setAttribute("aria-current", "false");
    dot.addEventListener("click", () => setSlide(index));
    dots.append(dot);
  });
  document.querySelector("#previous-slide").addEventListener("click", () => setSlide(currentSlide - 1));
  document.querySelector("#next-slide").addEventListener("click", () => setSlide(currentSlide + 1));
  setSlide(0);
  if (slides.length > 1) {
    slideTimer = window.setInterval(() => setSlide(currentSlide + 1), 6000);
    document.querySelector(".hero").addEventListener("mouseenter", () => window.clearInterval(slideTimer), { once: true });
  }
}

async function initializeStore() {
  document.querySelector("#year").textContent = String(new Date().getFullYear());
  try {
    const [productsResponse, configResponse] = await Promise.all([
      fetch("data/products.json", { cache: "no-cache" }),
      fetch("data/config.json", { cache: "no-cache" })
    ]);
    if (!productsResponse.ok) throw new Error("ما قدرناش نحملو المنتجات. عاود تحديث الصفحة.");
    if (!configResponse.ok) throw new Error("ما قدرناش نحملو إعدادات المتجر.");
    const [products, config] = await Promise.all([productsResponse.json(), configResponse.json()]);
    if (!Array.isArray(products)) throw new Error("ملف المنتجات فيه صيغة غير صحيحة.");
    storeConfig = config;
    if (/^#[0-9a-f]{6}$/i.test(config.theme?.primary_color || "")) {
      document.documentElement.style.setProperty("--green", config.theme.primary_color);
    }
    if (typeof config.theme?.font_family === "string") document.documentElement.style.fontFamily = config.theme.font_family;
    if (config.store_name) {
      document.querySelector("#store-name").textContent = config.store_name;
      document.querySelector("#footer-store-name").textContent = config.store_name;
      document.title = `${config.store_name} | تسوق بسهولة`;
    }
    if (config.logo_url) {
      document.querySelectorAll(".brand-mark").forEach((mark) => {
        const logo = document.createElement("img");
        logo.src = config.logo_url;
        logo.alt = "";
        logo.className = "store-logo";
        mark.replaceWith(logo);
      });
    }
    const announcement = document.querySelector("#announcement");
    if (config.announcement_text) {
      announcement.textContent = config.announcement_text;
      announcement.hidden = false;
    }
    if (config.store_phone) {
      const footerPhone = document.querySelector("#footer-phone");
      footerPhone.href = `tel:${config.store_phone.replace(/[^\d+]/g, "")}`;
      footerPhone.textContent = config.store_phone;
      footerPhone.hidden = false;
    }
    setupSlider(config);
    renderProducts(products);
    productsStatus.textContent = products.some((product) => product.status !== "draft") ? "" : "ما كايناش منتجات معروضة دابا.";
  } catch (error) {
    productsStatus.textContent = error.message || "وقع مشكل فتحميل المتجر.";
    productsStatus.classList.add("error");
  }
}

document.querySelector("#close-dialog").addEventListener("click", () => orderDialog.close());
orderDialog.addEventListener("click", (event) => {
  if (event.target === orderDialog) orderDialog.close();
});
orderForm.addEventListener("submit", submitOrder);
initializeStore();
