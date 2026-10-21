(async function applyPublicStoreConfig() {
  try {
    const response = await fetch("data/config.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Store settings are unavailable.");
    const config = await response.json();
    document.querySelectorAll("[data-store-phone]").forEach((link) => {
      const phone = String(config.store_phone || "");
      link.href = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : "contact.html";
      if (phone) link.textContent = phone;
    });
    document.querySelectorAll(".brand > span:last-child").forEach((name) => {
      if (config.store_name) name.textContent = config.store_name;
    });
    if (config.store_name) {
      document.title = document.title.includes(config.store_name) ? document.title : `${document.title} | ${config.store_name}`;
      document.querySelectorAll('meta[property^="og:"]').forEach((meta) => {
        meta.content = meta.content.replace(/MougaMarket/g, config.store_name);
        if (meta.getAttribute("property") === "og:site_name") meta.content = config.store_name;
        if (meta.getAttribute("property") === "og:title" && !meta.content.includes(config.store_name)) {
          meta.content = `${meta.content} | ${config.store_name}`;
        }
      });
      const copyright = document.querySelector(".site-footer > p");
      if (copyright) copyright.textContent = `© ${new Date().getFullYear()} ${config.store_name}`;
    }
    if (/^#[0-9a-f]{6}$/i.test(config.theme?.primary_color || "")) {
      document.documentElement.style.setProperty("--blue", config.theme.primary_color);
    }
    if (typeof config.theme?.font_family === "string") document.documentElement.style.fontFamily = config.theme.font_family;
    if (config.announcement_text) {
      let bar = document.querySelector("#announcement");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "announcement";
        bar.className = "announcement";
        document.body.prepend(bar);
      }
      bar.textContent = config.announcement_text;
      bar.hidden = false;
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
  } catch (error) {
    console.error("Could not apply store settings:", error);
  }
})();
