// Tiny static server for the comparison demo. No dependencies.
// Serves public/ and /config.js, which passes the optional Web SDK license key to the page.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const port = Number(process.env.PORT || 4510);
const host = process.env.HOST || "127.0.0.1";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (path === "/config.js") {
    const config = { licenseKey: process.env.NUTRIENT_LICENSE_KEY || "" };
    res.writeHead(200, { "content-type": types[".js"], "cache-control": "no-store" });
    res.end(`window.APP_CONFIG = ${JSON.stringify(config)};\n`);
    return;
  }
  const file = normalize(join(root, path === "/" ? "index.html" : path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}).listen(port, host, () => {
  console.log(`Document comparison demo on http://localhost:${port}`);
});
