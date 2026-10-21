import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml"
};

export function createStaticServer() {
  return createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const requested = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = resolve(root, requested);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const details = await stat(file);
    if (!details.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end("Not found");
  }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createStaticServer().listen(4173, "127.0.0.1", () => console.log("Test server listening on http://127.0.0.1:4173"));
}
