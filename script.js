class Cart {
  constructor(storageKey = "mouga-cart") {
    this.storageKey = storageKey;
    this.items = this.read();
  }

  read() {
    try {
      const savedItems = JSON.parse(localStorage.getItem(this.storageKey));
      return Array.isArray(savedItems) ? savedItems : [];
    } catch {
      return [];
    }
  }

  save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.items));
  }

  add(product) {
    const item = this.items.find((cartItem) => cartItem.id === product.id);
    if (item) {
      item.quantity += 1;
    } else {
      this.items.push({ ...product, quantity: 1 });
    }
    this.save();
  }

  changeQuantity(productId, change) {
    const item = this.items.find((cartItem) => cartItem.id === productId);
    if (!item) return;
    item.quantity += change;
    if (item.quantity <= 0) {
      this.remove(productId);
    } else {
      this.save();
    }
  }

  remove(productId) {
    this.items = this.items.filter((item) => item.id !== productId);
    this.save();
  }

  get count() {
    return this.items.reduce((total, item) => total + item.quantity, 0);
  }

  get total() {
    return this.items.reduce((total, item) => total + item.price * item.quantity, 0);
  }
}

class CheckoutManager {
  constructor(cart, onSuccess) {
    this.cart = cart;
    this.onSuccess = onSuccess;
    this.emailConfig = {
      publicKey: "BRMPjEjPFGpnw7VJD",
  serviceId: "service_dftcmfx", 
  templateId: "template_gzg27fo",
  recipient: "mogamarket20@gmail.com"
    };
    this.modal = document.querySelector("#checkout-modal");
    this.form = document.querySelector("#checkout-form");
    this.status = document.querySelector("#checkout-status");
    this.openButton = document.querySelector("[data-checkout-open]");
  }

  init() {
    this.openButton.addEventListener("click", () => this.open());
    this.modal.addEventListener("click", (event) => {
      if (event.target.matches("[data-checkout-close], .checkout-backdrop")) this.close();
    });
    this.form.addEventListener("submit", (event) => this.submit(event));
  }

  open() {
    if (!this.cart.items.length) return;
    this.setStatus("");
    this.modal.classList.add("is-open");
    this.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("overflow-hidden");
    this.form.elements.customer_name.focus();
  }

  close() {
    this.modal.classList.remove("is-open");
    this.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("overflow-hidden");
  }

  buildOrderDetails() {
    return this.cart.items.map((item) => `${item.title} x${item.quantity} = ${(item.price * item.quantity).toFixed(2)} $`).join("\n");
  }

  async submit(event) {
    event.preventDefault();
    if (!this.form.reportValidity() || !this.cart.items.length) return;

    const submitButton = this.form.querySelector("button[type=submit]");
    const formData = new FormData(this.form);
    const order = {
      customer_name: formData.get("customer_name"),
      customer_email: formData.get("customer_email"),
      customer_phone: formData.get("customer_phone"),
      customer_address: formData.get("customer_address"),
      customer_note: formData.get("customer_note") || "لا توجد",
      order_details: this.buildOrderDetails(),
      order_total: `${this.cart.total.toFixed(2)} $`
    };

    submitButton.disabled = true;
    this.setStatus("جارٍ تجهيز الطلب...", "pending");

    try {
      if (this.isEmailJsConfigured()) {
        window.emailjs.init({ publicKey: this.emailConfig.publicKey });
        await window.emailjs.send(this.emailConfig.serviceId, this.emailConfig.templateId, order);
      } else {
        this.sendByMailto(order);
      }
      this.setStatus("تم تجهيز طلبك بنجاح. سنتواصل معك قريباً لتأكيده.", "success");
      this.cart.items = [];
      this.cart.save();
      this.onSuccess();
      setTimeout(() => this.close(), 1800);
    } catch (error) {
      console.error(error);
      this.setStatus("تعذر الإرسال عبر EmailJS، سنفتح تطبيق البريد لإرسال الطلب بدلاً من ذلك.", "error");
      this.sendByMailto(order);
    } finally {
      submitButton.disabled = false;
    }
  }

  isEmailJsConfigured() {
    const { publicKey, serviceId, templateId } = this.emailConfig;
    return Boolean(window.emailjs && publicKey && serviceId && templateId);
  }

  sendByMailto(order) {
    const subject = encodeURIComponent(`طلب جديد من ${order.customer_name}`);
    const body = encodeURIComponent(`الاسم: ${order.customer_name}\nالبريد: ${order.customer_email}\nالهاتف: ${order.customer_phone}\nالعنوان: ${order.customer_address}\nملاحظات: ${order.customer_note}\n\nالمنتجات:\n${order.order_details}\n\nالإجمالي: ${order.order_total}`);
    window.location.href = `mailto:${this.emailConfig.recipient}?subject=${subject}&body=${body}`;
  }

  setStatus(message, type = "") {
    this.status.textContent = message;
    this.status.className = message ? `rounded-lg p-3 text-sm ${type === "success" ? "bg-sky-50 text-blue-900" : type === "error" ? "bg-slate-100 text-slate-900" : "bg-slate-100 text-slate-700"}` : "hidden rounded-lg p-3 text-sm";
  }
}

class UIManager {
  constructor() {
    this.products = [];
    this.activeCategory = "الكل";
    this.cart = new Cart();
    this.elements = {
      productGrid: document.querySelector("#product-grid"),
      productCount: document.querySelector("#product-count"),
      categoryList: document.querySelector("#category-list"),
      cartButton: document.querySelector("[data-cart-open]"),
      cartDrawer: document.querySelector("#cart-drawer"),
      cartItems: document.querySelector("#cart-items"),
      cartCount: document.querySelector("[data-cart-count]"),
      cartTotal: document.querySelector("#cart-total"),
      emptyCart: document.querySelector("#empty-cart"),
      checkoutButton: document.querySelector("[data-checkout-open]")
    };
    this.checkoutManager = new CheckoutManager(this.cart, () => this.renderCart());
  }

  async init() {
    try {
      const response = await fetch("products.json");
      if (!response.ok) throw new Error("تعذر تحميل المنتجات");
      this.products = await response.json();
      this.renderCategories();
      this.renderProducts();
      this.renderCart();
      this.bindEvents();
    } catch (error) {
      this.elements.productGrid.innerHTML = `<p class="col-span-full rounded-lg bg-slate-100 p-5 text-center text-slate-900">تعذر تحميل المنتجات. شغّل المشروع عبر خادم محلي ثم أعد المحاولة.</p>`;
      console.error(error);
    }
  }

  renderCategories() {
    const categories = ["الكل", ...new Set(this.products.map((product) => product.category))];
    this.elements.categoryList.innerHTML = categories.map((category) => `
      <button type="button" class="category-button rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold ${category === this.activeCategory ? "is-active" : ""}" data-category="${category}">
        ${category}
      </button>
    `).join("");
  }

  renderProducts() {
    const visibleProducts = this.activeCategory === "الكل"
      ? this.products
      : this.products.filter((product) => product.category === this.activeCategory);

    this.elements.productCount.textContent = `${visibleProducts.length} منتجات`;
    this.elements.productGrid.innerHTML = visibleProducts.map((product, index) => `
      <article class="product-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" style="animation-delay: ${index * 60}ms">
        <div class="product-image relative flex aspect-square items-center justify-center text-blue-900">
          <img src="${product.image}" alt="${product.title}" class="absolute inset-0 h-full w-full object-cover" onerror="this.remove()">
          <i class="fa-solid fa-house-chimney text-5xl" aria-hidden="true"></i>
          ${product.badge ? `<span class="absolute right-3 top-3 rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white">${product.badge}</span>` : ""}
        </div>
        <div class="p-4">
          <p class="text-xs font-bold text-slate-500">${product.category} · ${product.size}</p>
          <h3 class="mt-2 font-bold text-slate-900">${product.title}</h3>
          <p class="mt-2 min-h-12 text-sm leading-6 text-slate-500">${product.description}</p>
          <div class="mt-4 flex items-center justify-between gap-3">
            <div>
              <span class="font-extrabold text-blue-900">${product.price.toFixed(2)} $</span>
              ${product.oldPrice ? `<del class="mr-2 text-xs text-slate-400">${product.oldPrice.toFixed(2)} $</del>` : ""}
            </div>
            <button type="button" class="rounded-lg bg-blue-900 px-3 py-2 text-sm font-bold text-white transition hover:bg-black" data-add-to-cart="${product.id}">
              <i class="fa-solid fa-plus ml-1" aria-hidden="true"></i> أضف
            </button>
          </div>
        </div>
      </article>
    `).join("");
  }

  renderCart() {
    this.elements.cartCount.textContent = this.cart.count;
    this.elements.cartTotal.textContent = `${this.cart.total.toFixed(2)} $`;
    this.elements.emptyCart.classList.toggle("hidden", this.cart.items.length > 0);
    this.elements.checkoutButton.disabled = this.cart.items.length === 0;

    this.elements.cartItems.innerHTML = this.cart.items.map((item) => `
      <div class="cart-item flex gap-3 py-4" data-cart-item="${item.id}">
        <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-blue-900"><i class="fa-solid fa-house" aria-hidden="true"></i></div>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2"><h3 class="truncate text-sm font-bold">${item.title}</h3><button type="button" class="text-slate-400 hover:text-slate-900" data-remove-item="${item.id}" aria-label="حذف ${item.title}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></div>
          <p class="mt-1 text-sm font-bold text-blue-900">${(item.price * item.quantity).toFixed(2)} $</p>
          <div class="mt-2 flex items-center gap-2"><button type="button" class="h-7 w-7 rounded border border-slate-300" data-quantity-change="-1" data-product-id="${item.id}">-</button><span class="min-w-5 text-center text-sm">${item.quantity}</span><button type="button" class="h-7 w-7 rounded border border-slate-300" data-quantity-change="1" data-product-id="${item.id}">+</button></div>
        </div>
      </div>
    `).join("");
  }

  setDrawer(open) {
    this.elements.cartDrawer.classList.toggle("is-open", open);
    this.elements.cartDrawer.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("overflow-hidden", open);
  }

  bindEvents() {
    this.elements.categoryList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      this.activeCategory = button.dataset.category;
      this.renderCategories();
      this.renderProducts();
    });

    this.elements.productGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-to-cart]");
      if (!button) return;
      const product = this.products.find((item) => item.id === Number(button.dataset.addToCart));
      this.cart.add(product);
      this.renderCart();
      this.setDrawer(true);
    });

    this.elements.cartItems.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-item]");
      const quantityButton = event.target.closest("[data-quantity-change]");
      if (removeButton) this.cart.remove(Number(removeButton.dataset.removeItem));
      if (quantityButton) this.cart.changeQuantity(Number(quantityButton.dataset.productId), Number(quantityButton.dataset.quantityChange));
      this.renderCart();
    });

    this.elements.cartButton.addEventListener("click", () => this.setDrawer(true));
    this.elements.cartDrawer.addEventListener("click", (event) => {
      if (event.target.matches("[data-cart-close], .cart-backdrop")) this.setDrawer(false);
    });
    this.checkoutManager.init();
  }
}

document.addEventListener("DOMContentLoaded", () => new UIManager().init());
