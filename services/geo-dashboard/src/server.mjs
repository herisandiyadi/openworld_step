// Admin dashboard service: trigger generate + lihat status job.
// Port terpisah (19101). Token admin disimpan server-side, tidak pernah dikirim ke browser.
// Zero dependency: Node built-in only.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.DASH_PORT || 19101);
const HOST = process.env.DASH_HOST || "127.0.0.1";
const GENERATOR = process.env.GEO_GENERATOR_URL || "http://127.0.0.1:19100";
const ADMIN_TOKEN = process.env.GEO_ADMIN_TOKEN || "";
const PUBLIC = join(ROOT, "public");

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "geo-dashboard", port: PORT, generator: GENERATOR });
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(join(PUBLIC, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // Proxy baca status job (GET) — tidak butuh token di browser.
    const m = url.pathname.match(/^\/api\/jobs\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const r = await fetch(`${GENERATOR}/jobs/${m[1]}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
      const body = await r.text();
      res.writeHead(r.status, { "Content-Type": "application/json" });
      return res.end(body);
    }

    // Buat job generate (POST) — token ditempel di sini, bukan dari browser.
    if (req.method === "POST" && url.pathname === "/api/jobs") {
      let raw = "";
      for await (const c of req) { raw += c; if (raw.length > 8192) return json(res, 413, { error: "too large" }); }
      const r = await fetch(`${GENERATOR}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}` },
        body: raw || "{}",
      });
      const body = await r.text();
      res.writeHead(r.status, { "Content-Type": "application/json" });
      return res.end(body);
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error("[dashboard 500]", url.pathname, err && err.stack ? err.stack : err);
    return json(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, HOST, () => console.log(`geo-dashboard listening on http://${HOST}:${PORT} -> ${GENERATOR}`));
