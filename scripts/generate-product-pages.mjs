import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const products = JSON.parse(await readFile(join(root, "data/products.json"), "utf8"));
const config = JSON.parse(await readFile(join(root, "data/config.json"), "utf8"));
const domain = (await readFile(join(root, "CNAME"), "utf8")).trim();
const base = `https://${domain}`;
const out = join(root, "products");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function toAbsoluteImage(product) {
  const source = product.images?.[0] || product.image || "";
  try { return new URL(source, base).href; } catch { return ""; }
}

await mkdir(out, { recursive: true });
const pageNames = new Set();
for (const product of products) {
  if (product.status === "draft" || !/^[a-zA-Z0-9_-]{1,100}$/.test(product.id)) continue;
  const fileName = `${product.id}.html`;
  pageNames.add(fileName);
  const url = `${base}/products/${encodeURIComponent(product.id)}.html`;
  const description = String(product.description || `تسوق ${product.name} من ${config.store_name}، مع التوصيل لجميع المدن المغربية والدفع عند الاستلام.`).slice(0, 300);
  const image = toAbsoluteImage(product);
  const safeSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    sku: product.id,
    ...(image ? { image } : {}),
    ...(product.category ? { category: product.category } : {}),
    brand: { "@type": "Brand", name: config.store_name },
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "MAD",
      price: Number(product.price).toFixed(2),
      availability: Number(product.stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
    }
  }).replace(/</g, "\\u003c");
  const page = `<!doctype html>
<!-- Generated product preview; do not edit by hand. -->
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow">
<title>${escapeHtml(product.name)} | ${escapeHtml(config.store_name)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="product">
<meta property="og:locale" content="ar_MA">
<meta property="og:site_name" content="${escapeHtml(config.store_name)}">
<meta property="og:title" content="${escapeHtml(product.name)} | ${escapeHtml(config.store_name)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}
<script type="application/ld+json">${safeSchema}</script>
<meta http-equiv="refresh" content="0;url=../product.html?id=${encodeURIComponent(product.id)}">
</head>
<body><p><a href="../product.html?id=${encodeURIComponent(product.id)}">شوف ${escapeHtml(product.name)} وطلب دابا</a></p><script>location.replace("../product.html?id=${encodeURIComponent(product.id)}");</script></body>
</html>
`;
  await writeFile(join(out, fileName), page);
}

for (const fileName of await readdir(out)) {
  if (fileName.endsWith(".html") && !pageNames.has(fileName)) {
    const filePath = join(out, fileName);
    const contents = await readFile(filePath, "utf8");
    if (contents.startsWith("<!doctype html>\n<!-- Generated product preview; do not edit by hand. -->")) {
      await unlink(filePath);
    }
  }
}

const staticPages = ["", "product.html", "contact.html", "privacy-policy.html", "terms.html"];
const paths = [...staticPages.map((page) => `${base}/${page}`), ...[...pageNames].map((page) => `${base}/products/${page}`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
await writeFile(join(root, "sitemap.xml"), sitemap);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Generated ${pageNames.size} product preview pages and sitemap.`);
}
