(function setupPixelTracking() {
  const initialized = new Set();
  window.trackStoreEvent = (pixelId, eventName, parameters) => {
    if (!/^\d{5,20}$/.test(String(pixelId || ""))) return;
    if (!window.fbq) {
      const fbq = function () {
        fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
      };
      fbq.queue = [];
      fbq.loaded = true;
      fbq.version = "2.0";
      window.fbq = fbq;
    }
    if (!initialized.has(pixelId)) {
      window.fbq("init", pixelId);
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.append(script);
      initialized.add(pixelId);
    }
    window.fbq("track", eventName, parameters || {});
  };
})();
