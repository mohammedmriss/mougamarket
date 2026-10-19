const connectionForm = document.querySelector("#connection-form");
const connectionMessage = document.querySelector("#connection-message");
const productsMessage = document.querySelector("#products-message");
const editorMessage = document.querySelector("#editor-message");
const adminWorkspace = document.querySelector("#admin-workspace");
const adminProducts = document.querySelector("#admin-products");
const productForm = document.querySelector("#product-form");

const PRODUCTS_PATH = "data/products.json";
const API_ROOT = "https://api.github.com";
let githubToken = "";
let repository = "";
let branch = "main";
let products = [];
let fileSha = "";

function setMessage(target, text, type = "") {
  target.textContent = text;
  target.className = `admin-message${type ? ` ${type}` : ""}`;
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function fileUrl() {
  const [owner, repo] = repository.split("/");
  return `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${PRODUCTS_PATH}`;
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("GitHub رفض الاتصال. تحقق من التوكن والصلاحيات واسم الفرع.");
    }
    if (response.status === 404) throw new Error("ما لقيناش المستودع أو الملف. تأكد من owner/repo والفرع.");
    throw new Error(payload.message || `فشل طلب GitHub (HTTP ${response.status}).`);
  }
  return payload;
}

async function readProducts() {
  const url = `${fileUrl()}?ref=${encodeURIComponent(branch)}`;
  const file = await githubRequest(url);
  if (file.encoding !== "base64" || typeof file.content !== "string") {
    throw new Error("GitHub رجع صيغة ملف غير متوقعة.");
  }
  const parsed = JSON.parse(decodeBase64Utf8(file.content));
  if (!Array.isArray(parsed)) throw new Error("data/products.json خاصو يكون لائحة منتجات.");
  fileSha = file.sha;
  return parsed;
}

function renderAdminProducts() {
  adminProducts.replaceChildren();
  products.forEach((product) => {
    const row = document.createElement("article");
    row.className = "admin-product";
    const image = document.createElement("img");
    image.src = product.image;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.removeAttribute("src"), { once: true });
    const details = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = product.name;
    const price = document.createElement("p");
    price.textContent = `${new Intl.NumberFormat("fr-MA").format(product.price)} درهم`;
    details.append(name, price);
    const actions = document.createElement("div");
    actions.className = "admin-product-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "تعديل";
    edit.addEventListener("click", () => editProduct(product.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-product";
    remove.textContent = "حذف";
    remove.addEventListener("click", () => deleteProduct(product.id));
    actions.append(edit, remove);
    row.append(image, details, actions);
    adminProducts.append(row);
  });
  if (!products.length) {
    const empty = document.createElement("p");
    empty.className = "admin-message";
    empty.textContent = "مازال ما كاين حتى منتج. زيد أول منتج ديالك.";
    adminProducts.append(empty);
  }
}

async function refreshProducts() {
  setMessage(productsMessage, "كنقراو المنتجات من GitHub...");
  try {
    products = await readProducts();
    renderAdminProducts();
    setMessage(productsMessage, `لقينا ${products.length} منتجات.`, "success");
  } catch (error) {
    setMessage(productsMessage, error.message, "error");
    throw error;
  }
}

function resetEditor() {
  productForm.reset();
  document.querySelector("#product-id").value = "";
  document.querySelector("#editor-title").textContent = "إضافة منتج";
  setMessage(editorMessage, "");
}

function editProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product) {
    setMessage(editorMessage, "ما لقيناش هاد المنتج فاللائحة.", "error");
    return;
  }
  document.querySelector("#product-id").value = product.id;
  document.querySelector("#product-name").value = product.name;
  document.querySelector("#product-price").value = product.price;
  document.querySelector("#product-image").value = product.image;
  document.querySelector("#product-description").value = product.description;
  document.querySelector("#editor-title").textContent = "تعديل منتج";
  setMessage(editorMessage, "");
  document.querySelector("#editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveProducts(commitMessage) {
  const payload = {
    message: commitMessage,
    content: encodeBase64Utf8(`${JSON.stringify(products, null, 2)}\n`),
    sha: fileSha,
    branch
  };
  const saved = await githubRequest(fileUrl(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!saved.content || !saved.content.sha) {
    throw new Error("ما وصلناش تأكيد من GitHub بأن الملف تحفظ.");
  }
  fileSha = saved.content.sha;
}

async function deleteProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product || !window.confirm(`واش متأكد بغيتي تحذف "${product.name}"؟`)) return;
  const previousProducts = products;
  products = products.filter((item) => item.id !== id);
  try {
    await saveProducts(`Delete product: ${product.name}`);
    renderAdminProducts();
    setMessage(productsMessage, "تحذف المنتج وتحدّث الملف في GitHub.", "success");
    if (document.querySelector("#product-id").value === id) resetEditor();
  } catch (error) {
    products = previousProducts;
    renderAdminProducts();
    setMessage(productsMessage, error.message, "error");
  }
}

connectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(connectionForm);
  const newRepository = String(formData.get("repository") || "").trim();
  const newBranch = String(formData.get("branch") || "").trim();
  const newToken = String(formData.get("token") || "").trim();
  document.querySelector("#github-token").value = "";
  if (!/^[^/\s]+\/[^/\s]+$/.test(newRepository)) {
    setMessage(connectionMessage, "كتب اسم المستودع بهاد الشكل: username/repository.", "error");
    return;
  }
  if (!newBranch || !newToken) {
    setMessage(connectionMessage, "دخل الفرع والتوكن ديال GitHub.", "error");
    return;
  }
  repository = newRepository;
  branch = newBranch;
  githubToken = newToken;
  document.querySelector("#connect-button").disabled = true;
  setMessage(connectionMessage, "كنتحققو من الاتصال...");
  try {
    await refreshProducts();
    adminWorkspace.hidden = false;
    document.querySelector("#connection-indicator").textContent = "متصل";
    document.querySelector("#connection-indicator").classList.add("connected");
    setMessage(connectionMessage, "الاتصال خدام. التوكن ما غاديش يتخزن من بعد ما تسد هاد التبويب.", "success");
  } catch (error) {
    githubToken = "";
    setMessage(connectionMessage, error.message, "error");
  } finally {
    document.querySelector("#connect-button").disabled = false;
  }
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(productForm);
  const oldId = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const image = String(formData.get("image") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const price = Number(formData.get("price"));
  if (!name || !description || !Number.isFinite(price) || price <= 0) {
    setMessage(editorMessage, "راجع الاسم والوصف والثمن؛ خاص الثمن يكون أكبر من صفر.", "error");
    return;
  }
  try {
    const imageUrl = new URL(image);
    if (imageUrl.protocol !== "https:" && imageUrl.protocol !== "http:") throw new Error();
  } catch {
    setMessage(editorMessage, "دخل رابط صورة صحيح كيبدا بـ https:// أو http://.", "error");
    return;
  }
  const id = oldId || `product-${crypto.randomUUID()}`;
  const updated = { id, name, price, image, description };
  const duplicate = products.some((product) => product.id !== oldId && product.name === name);
  if (duplicate) {
    setMessage(editorMessage, "كاين منتج آخر بنفس الاسم؛ اختار اسم مختلف باش يسهل التدبير.", "error");
    return;
  }
  const previousProducts = products;
  products = oldId
    ? products.map((product) => product.id === oldId ? updated : product)
    : [...products, updated];
  document.querySelector("#save-product").disabled = true;
  setMessage(editorMessage, "كنحفظو التغيير في GitHub...");
  try {
    await saveProducts(`${oldId ? "Update" : "Add"} product: ${name}`);
    renderAdminProducts();
    resetEditor();
    setMessage(productsMessage, "تحفظ التغيير في GitHub. الموقع غادي يتحدث من بعد لحظات.", "success");
  } catch (error) {
    products = previousProducts;
    renderAdminProducts();
    setMessage(editorMessage, error.message, "error");
  } finally {
    document.querySelector("#save-product").disabled = false;
  }
});

document.querySelector("#new-product").addEventListener("click", () => {
  resetEditor();
  document.querySelector("#editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#cancel-edit").addEventListener("click", resetEditor);
window.addEventListener("pagehide", () => { githubToken = ""; });
