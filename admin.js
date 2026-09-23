const ADMIN_PASSWORD = "mouga-admin";
const PRODUCTS_STORAGE_KEY = "mouga-admin-products";
const GITHUB_CONFIG_KEY = "mouga-github-config";

class GitHubClient {
  constructor(config) {
    this.config = config;
    this.apiBase = "https://api.github.com";
  }

  get endpoint() {
    const { owner, repo } = this.config;
    return `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`;
  }

  async request(path, options = {}) {
    const [filePath, queryString] = path.split("?");
    const url = `${this.endpoint}/${filePath.split("/").map(encodeURIComponent).join("/")}${queryString ? `?${queryString}` : ""}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      let message = `GitHub API error (${response.status})`;
      try {
        const details = await response.json();
        if (details.message) message = details.message;
      } catch {
        // Keep the HTTP status when GitHub does not return JSON.
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async getFile(path) {
    try {
      return await this.request(`${path}?ref=${encodeURIComponent(this.config.branch)}`);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  decodeContent(encodedContent) {
    const binary = atob(encodedContent.replace(/\n/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  encodeContent(content) {
    const bytes = new TextEncoder().encode(content);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  async saveFile(path, content, message) {
    const existingFile = await this.getFile(path);
    const body = {
      message,
      content: this.encodeContent(content),
      branch: this.config.branch
    };
    if (existingFile?.sha) body.sha = existingFile.sha;
    return this.request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async loadProducts() {
    const file = await this.getFile("products.json");
    if (!file) throw new Error("لم يتم العثور على products.json في الفرع المحدد.");
    return JSON.parse(this.decodeContent(file.content));
  }

  async saveProducts(products) {
    const content = `${JSON.stringify(products, null, 2)}\n`;
    return this.saveFile("products.json", content, "Update products from Mouga admin");
  }

  async uploadImage(file, filename) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("تعذر قراءة ملف الصورة."));
      reader.readAsDataURL(file);
    });
    const path = `img/${filename}`;
    const existingFile = await this.getFile(path);
    const body = {
      message: `Upload ${filename} from Mouga admin`,
      content: base64,
      branch: this.config.branch
    };
    if (existingFile?.sha) body.sha = existingFile.sha;
    await this.request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return path;
  }
}

class AdminPanel {
  constructor() {
    this.products = [];
    this.elements = {
      loginView: document.querySelector("#login-view"),
      dashboardView: document.querySelector("#dashboard-view"),
      loginForm: document.querySelector("#login-form"),
      loginStatus: document.querySelector("#login-status"),
      logoutButton: document.querySelector("#logout-button"),
      newProductButton: document.querySelector("#new-product-button"),
      productSearch: document.querySelector("#product-search"),
      productsTableBody: document.querySelector("#products-table-body"),
      emptyProducts: document.querySelector("#empty-products"),
      totalProducts: document.querySelector("#total-products"),
      featuredProducts: document.querySelector("#featured-products"),
      categoryTotal: document.querySelector("#category-total"),
      dialog: document.querySelector("#product-dialog"),
      form: document.querySelector("#product-form"),
      dialogTitle: document.querySelector("#dialog-title"),
      formStatus: document.querySelector("#form-status"),
      closeDialog: document.querySelector("#close-dialog"),
      cancelDialog: document.querySelector("#cancel-dialog"),
      githubForm: document.querySelector("#github-form"),
      githubOwner: document.querySelector("#github-owner"),
      githubRepo: document.querySelector("#github-repo"),
      githubBranch: document.querySelector("#github-branch"),
      githubToken: document.querySelector("#github-token"),
      githubLoadButton: document.querySelector("#github-load-button"),
      githubSaveButton: document.querySelector("#github-save-button"),
      githubStatus: document.querySelector("#github-status"),
      githubConnectionState: document.querySelector("#github-connection-state"),
      productImageFile: document.querySelector("#product-image-file")
    };
    this.githubClient = null;
  }

  init() {
    this.elements.loginForm.addEventListener("submit", (event) => this.login(event));
    this.elements.logoutButton.addEventListener("click", () => this.logout());
    this.elements.newProductButton.addEventListener("click", () => this.openForm());
    this.elements.productSearch.addEventListener("input", () => this.renderTable());
    this.elements.productsTableBody.addEventListener("click", (event) => this.handleTableAction(event));
    this.elements.form.addEventListener("submit", (event) => this.saveProduct(event));
    this.elements.closeDialog.addEventListener("click", () => this.closeForm());
    this.elements.cancelDialog.addEventListener("click", () => this.closeForm());
    this.elements.githubForm.addEventListener("submit", (event) => this.testGitHubConnection(event));
    this.elements.githubLoadButton.addEventListener("click", () => this.loadFromGitHub());
    this.elements.githubSaveButton.addEventListener("click", () => this.saveToGitHub());
    this.elements.dialog.addEventListener("click", (event) => {
      if (event.target === this.elements.dialog) this.closeForm();
    });

    this.loadGitHubConfig();

    if (sessionStorage.getItem("mouga-admin-auth") === "true") this.showDashboard();
  }

  loadGitHubConfig() {
    try {
      const config = JSON.parse(sessionStorage.getItem(GITHUB_CONFIG_KEY));
      if (!config) return;
      this.elements.githubOwner.value = config.owner || "";
      this.elements.githubRepo.value = config.repo || "";
      this.elements.githubBranch.value = config.branch || "main";
      this.elements.githubToken.value = config.token || "";
    } catch {
      sessionStorage.removeItem(GITHUB_CONFIG_KEY);
    }
  }

  getGitHubConfig() {
    return {
      owner: this.elements.githubOwner.value.trim(),
      repo: this.elements.githubRepo.value.trim(),
      branch: this.elements.githubBranch.value.trim() || "main",
      token: this.elements.githubToken.value.trim()
    };
  }

  createGitHubClient() {
    const config = this.getGitHubConfig();
    if (!config.owner || !config.repo || !config.branch || !config.token) throw new Error("أكمل جميع بيانات اتصال GitHub أولاً.");
    sessionStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(config));
    this.githubClient = new GitHubClient(config);
    return this.githubClient;
  }

  setGitHubStatus(message, type = "") {
    this.elements.githubStatus.textContent = message;
    this.elements.githubStatus.className = `form-status full-width ${type}`;
  }

  setConnectionState(connected) {
    this.elements.githubConnectionState.textContent = connected ? "متصل" : "غير متصل";
    this.elements.githubConnectionState.classList.toggle("is-connected", connected);
  }

  async testGitHubConnection(event) {
    event.preventDefault();
    try {
      const client = this.createGitHubClient();
      await client.getFile("products.json");
      this.setConnectionState(true);
      this.setGitHubStatus("تم الاتصال بالمستودع بنجاح.", "success");
    } catch (error) {
      this.setConnectionState(false);
      this.setGitHubStatus(`فشل الاتصال: ${error.message}`, "error");
    }
  }

  async loadFromGitHub() {
    try {
      const client = this.githubClient || this.createGitHubClient();
      this.setGitHubStatus("جارٍ تحميل المنتجات من GitHub...", "pending");
      this.products = await client.loadProducts();
      this.saveToBrowser();
      this.updateStats();
      this.renderTable();
      this.setConnectionState(true);
      this.setGitHubStatus(`تم تحميل ${this.products.length} منتجات من GitHub.`, "success");
    } catch (error) {
      this.setGitHubStatus(`تعذر التحميل: ${error.message}`, "error");
    }
  }

  async saveToGitHub() {
    try {
      const client = this.githubClient || this.createGitHubClient();
      this.elements.githubSaveButton.disabled = true;
      this.setGitHubStatus("جارٍ حفظ products.json في GitHub...", "pending");
      await client.saveProducts(this.products);
      this.setConnectionState(true);
      this.setGitHubStatus("تم حفظ المنتجات في GitHub بنجاح.", "success");
    } catch (error) {
      this.setGitHubStatus(`تعذر الحفظ: ${error.message}`, "error");
    } finally {
      this.elements.githubSaveButton.disabled = false;
    }
  }

  login(event) {
    event.preventDefault();
    const password = new FormData(this.elements.loginForm).get("admin-password");
    if (password !== ADMIN_PASSWORD) {
      this.elements.loginStatus.textContent = "كلمة المرور غير صحيحة.";
      return;
    }
    sessionStorage.setItem("mouga-admin-auth", "true");
    this.elements.loginStatus.textContent = "";
    this.showDashboard();
    this.elements.loginForm.reset();
  }

  logout() {
    sessionStorage.removeItem("mouga-admin-auth");
    this.elements.dashboardView.classList.add("is-hidden");
    this.elements.loginView.classList.remove("is-hidden");
    this.elements.loginForm.elements["admin-password"].focus();
  }

  async showDashboard() {
    this.elements.loginView.classList.add("is-hidden");
    this.elements.dashboardView.classList.remove("is-hidden");
    await this.loadProducts();
    this.updateStats();
    this.renderTable();
  }

  async loadProducts() {
    const savedProducts = localStorage.getItem(PRODUCTS_STORAGE_KEY);
    if (savedProducts) {
      try {
        this.products = JSON.parse(savedProducts);
        return;
      } catch {
        localStorage.removeItem(PRODUCTS_STORAGE_KEY);
      }
    }

    try {
      const response = await fetch("products.json");
      if (!response.ok) throw new Error("تعذر تحميل المنتجات");
      this.products = await response.json();
    } catch (error) {
      this.products = [];
      console.error(error);
    }
  }

  saveToBrowser() {
    localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(this.products));
  }

  updateStats() {
    this.elements.totalProducts.textContent = this.products.length;
    this.elements.featuredProducts.textContent = this.products.filter((product) => product.featured).length;
    this.elements.categoryTotal.textContent = new Set(this.products.map((product) => product.category)).size;
  }

  renderTable() {
    const query = this.elements.productSearch.value.trim().toLowerCase();
    const visibleProducts = this.products.filter((product) => `${product.title} ${product.category}`.toLowerCase().includes(query));
    this.elements.emptyProducts.classList.toggle("is-hidden", visibleProducts.length > 0);
    this.elements.productsTableBody.innerHTML = visibleProducts.map((product) => `
      <tr>
        <td><div class="product-cell"><div class="product-thumb"><img src="${product.image}" alt="" onerror="this.remove()"><i class="fa-solid fa-house-chimney" aria-hidden="true"></i></div><div><span class="product-name">${product.title}</span><span class="product-meta">#${product.id} · ${product.size}</span></div></div></td>
        <td>${product.category}</td>
        <td><strong>${Number(product.price).toFixed(2)} $</strong></td>
        <td>${product.featured ? '<span class="badge">مميز</span>' : '<span class="product-meta">عادي</span>'}</td>
        <td><div class="row-actions"><button type="button" data-edit-product="${product.id}" title="تعديل" aria-label="تعديل ${product.title}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button type="button" class="delete" data-delete-product="${product.id}" title="حذف" aria-label="حذف ${product.title}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></div></td>
      </tr>
    `).join("");
  }

  handleTableAction(event) {
    const editButton = event.target.closest("[data-edit-product]");
    const deleteButton = event.target.closest("[data-delete-product]");
    if (editButton) this.openForm(Number(editButton.dataset.editProduct));
    if (deleteButton) this.deleteProduct(Number(deleteButton.dataset.deleteProduct));
  }

  openForm(productId = null) {
    this.elements.form.reset();
    this.elements.formStatus.textContent = "";
    this.elements.form.dataset.editingId = productId || "";
    this.elements.dialogTitle.textContent = productId ? "تعديل منتج" : "إضافة منتج";
    if (productId) {
      const product = this.products.find((item) => item.id === productId);
      if (!product) return;
      document.querySelector("#product-id").value = product.id;
      document.querySelector("#product-title").value = product.title;
      document.querySelector("#product-category").value = product.category;
      document.querySelector("#product-price").value = product.price;
      document.querySelector("#product-old-price").value = product.oldPrice ?? "";
      document.querySelector("#product-size").value = product.size;
      document.querySelector("#product-badge").value = product.badge || "";
      document.querySelector("#product-image").value = product.image;
      document.querySelector("#product-description").value = product.description;
      document.querySelector("#product-featured").checked = Boolean(product.featured);
    }
    this.elements.dialog.showModal();
    document.querySelector("#product-title").focus();
  }

  closeForm() {
    this.elements.dialog.close();
  }

  async saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const getValue = (selector) => document.querySelector(selector).value.trim();
    const editingId = Number(form.dataset.editingId);
    const product = {
      id: editingId || this.nextId(),
      title: getValue("#product-title"),
      category: getValue("#product-category"),
      price: Number(getValue("#product-price")),
      oldPrice: getValue("#product-old-price") ? Number(getValue("#product-old-price")) : null,
      size: getValue("#product-size"),
      image: getValue("#product-image"),
      description: getValue("#product-description"),
      featured: document.querySelector("#product-featured").checked,
      badge: getValue("#product-badge")
    };
    const imageFile = this.elements.productImageFile.files[0];
    if (imageFile) {
      try {
        const client = this.githubClient || this.createGitHubClient();
        this.elements.formStatus.textContent = "جارٍ رفع الصورة إلى GitHub...";
        const safeName = `${product.id}-${this.slugify(product.title)}${this.fileExtension(imageFile.name)}`;
        product.image = await client.uploadImage(imageFile, safeName);
      } catch (error) {
        this.elements.formStatus.textContent = `تعذر رفع الصورة: ${error.message}`;
        return;
      }
    }
    const existingIndex = this.products.findIndex((item) => item.id === editingId);
    if (existingIndex >= 0) this.products[existingIndex] = product;
    else this.products.push(product);
    this.saveToBrowser();
    this.updateStats();
    this.renderTable();
    this.closeForm();
  }

  slugify(value) {
    return value.toString().trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-+|-+$/g, "") || "product";
  }

  fileExtension(filename) {
    const extension = filename.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/);
    return extension ? `.${extension[1]}`.replace(".jpeg", ".jpg") : ".jpg";
  }

  nextId() {
    return this.products.reduce((largestId, product) => Math.max(largestId, Number(product.id)), 0) + 1;
  }

  deleteProduct(productId) {
    const product = this.products.find((item) => item.id === productId);
    if (!product || !window.confirm(`حذف المنتج «${product.title}»؟`)) return;
    this.products = this.products.filter((item) => item.id !== productId);
    this.saveToBrowser();
    this.updateStats();
    this.renderTable();
  }
}

document.addEventListener("DOMContentLoaded", () => new AdminPanel().init());
