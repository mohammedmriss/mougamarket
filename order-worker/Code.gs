function jsonOutput(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID is missing from Script Properties.");
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheet = spreadsheet.getSheetByName("Orders") || spreadsheet.insertSheet("Orders");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["id", "createdAt", "status", "name", "phone", "city", "items", "itemsSummary", "total"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function safeCell(value) {
  var text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function doPost(event) {
  try {
    var body = JSON.parse(event.postData.contents);
    var expectedSecret = PropertiesService.getScriptProperties().getProperty("WORKER_SHARED_SECRET");
    if (!expectedSecret || body.secret !== expectedSecret) return jsonOutput({ ok: false, error: "Unauthorized." });
    var sheet = getSheet();

    if (body.action === "createOrder") {
      var order = body.order;
      if (!order || typeof order.id !== "string" || !Array.isArray(order.items) ||
          typeof order.name !== "string" || typeof order.phone !== "string" ||
          typeof order.city !== "string" || !Number.isFinite(Number(order.total))) {
        return jsonOutput({ ok: false, error: "Invalid order." });
      }
      var lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        sheet.appendRow([
          safeCell(order.id),
          safeCell(order.createdAt),
          "new",
          safeCell(order.name),
          safeCell(order.phone),
          safeCell(order.city),
          safeCell(JSON.stringify(order.items)),
          safeCell(order.itemsSummary),
          Number(order.total)
        ]);
      } finally {
        lock.releaseLock();
      }
      return jsonOutput({ ok: true });
    }

    if (body.action === "listOrders") {
      var values = sheet.getDataRange().getValues();
      var orders = values.slice(1).filter(function(row) { return row[0]; }).reverse().map(function(row) {
        var items = [];
        try { items = JSON.parse(row[6] || "[]"); } catch (error) { console.error(error); }
        return {
          id: String(row[0]),
          createdAt: String(row[1]),
          status: String(row[2] || "new"),
          name: String(row[3]),
          phone: String(row[4]),
          city: String(row[5]),
          items: items,
          itemsSummary: String(row[7]),
          total: Number(row[8]) || 0
        };
      });
      return jsonOutput({ ok: true, orders: orders });
    }

    if (body.action === "updateOrder") {
      var statuses = ["new", "confirmed", "shipped", "delivered", "cancelled"];
      if (typeof body.orderId !== "string" || statuses.indexOf(body.status) === -1) {
        return jsonOutput({ ok: false, error: "Invalid order or status." });
      }
      var lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i += 1) {
          if (String(rows[i][0]) === body.orderId) {
            sheet.getRange(i + 1, 3).setValue(safeCell(body.status));
            return jsonOutput({ ok: true, updated: true });
          }
        }
      } finally {
        lock.releaseLock();
      }
      return jsonOutput({ ok: true, updated: false });
    }
    return jsonOutput({ ok: false, error: "Unknown action." });
  } catch (error) {
    console.error(error);
    return jsonOutput({ ok: false, error: "Google Sheets operation failed." });
  }
}
