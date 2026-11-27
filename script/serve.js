/* Serve web/. The headers match web/_headers. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "web");
const port = Number(process.argv[2] || 8765);
const csp = process.argv[3] !== "--open";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".md": "text/plain; charset=utf-8"
};

function headers() {
  const out = { "cache-control": "no-store" };
  if (!csp) return out;
  const text = fs.readFileSync(path.join(root, "_headers"), "utf8");
  text.split("\n").forEach(function (line) {
    const m = line.match(/^\s{2}([^:]+):\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2];
  });
  return out;
}

const extra = headers();
http.createServer(function (req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  let file = decodeURIComponent(url.pathname);
  if (file === "/") file = "/index.html";
  const full = path.join(root, path.normalize(file));
  if (!full.startsWith(root) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, extra);
    res.end("not found");
    return;
  }
  const body = fs.readFileSync(full);
  const head = Object.assign({ "content-type": types[path.extname(full)] || "application/octet-stream" }, extra);
  res.writeHead(200, head);
  res.end(body);
}).listen(port, "127.0.0.1", function () {
  console.log("http://127.0.0.1:" + port + "/");
});
