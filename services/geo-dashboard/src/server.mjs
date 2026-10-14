// Admin dashboard service: trigger generate + lihat status job.
// Port terpisah (19101). Token admin disimpan server-side, tidak pernah dikirim ke browser.
// Zero dependency: Node built-in only.
//
// Akses: dilindungi HTTP Basic Auth saat DASH_USER + DASH_PASS_HASH di-set.
//   DASH_PASS_HASH = sha256 hex dari password. Tanpa hash, service hanya boleh bind ke
//   loopback (DASH_HOST=127.0.0.1) — kalau di-tunnel, auth wajib aktif.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.DASH_PORT || 19101);
const HOST = process.env.DASH_HOST || "127.0.0.1";
const GENERATOR = process.env.GEO_GENERATOR_URL || "http://127.0.0.1:19100";
const ADMIN_TOKEN = process.env.GEO_ADMIN_TOKEN || "";
const PUBLIC = join(ROOT, "public");
// outputDir job relatif terhadap web/ (generator spawn dengan cwd=web/).
const WEB_ROOT = process.env.GEO_WEB_ROOT || "/root/workspace/geo-map-pipeline/web";
const WORLD_DIR_RE = /^public\/world-([a-z0-9_-]+)$/i;

// Basic Auth (opsional; wajib dipasang bila port diekspos ke jaringan/tunnel).
const DASH_USER = process.env.DASH_USER || "";
const DASH_PASS_HASH = (process.env.DASH_PASS_HASH || "").toLowerCase();
const AUTH_ON = Boolean(DASH_USER && DASH_PASS_HASH);

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** Bandingkan dua hex-string dengan waktu konstan (panjang berbeda -> false). */
function safeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return timingSafeEqual(ba, bb);
}

/** true = request terautentikasi (atau auth memang dimatikan). */
function authorized(req) {
  if (!AUTH_ON) return true;
  const hdr = req.headers.authorization || "";
  if (!hdr.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(hdr.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return user === DASH_USER && safeHexEqual(sha256hex(pass), DASH_PASS_HASH);
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

/**
 * Validasi outputDir job -> path relatif aman di bawah WEB_ROOT.
 * Hanya menerima pola "public/world-<slug>"; mencegah path traversal.
 * @returns {string|null} path relatif ternormalisasi, atau null bila tidak valid.
 */
function safeWorldDir(outputDir) {
  if (typeof outputDir !== "string") return null;
  const norm = normalize(outputDir).replace(/\\/g, "/");
  if (!WORLD_DIR_RE.test(norm)) return null;
  if (norm.includes("..")) return null;
  return norm;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "geo-dashboard", port: PORT, generator: GENERATOR, auth: AUTH_ON });
    }
    if (!authorized(req)) {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="OpenWorld Geo Admin", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end("401 Unauthorized\n");
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(join(PUBLIC, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // Proxy list job (GET /api/jobs) — token ditempel server-side.
    if (req.method === "GET" && url.pathname === "/api/jobs") {
      const r = await fetch(`${GENERATOR}/jobs`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
      const body = await r.text();
      res.writeHead(r.status, { "Content-Type": "application/json" });
      return res.end(body);
    }

    // Preview map hasil generate: /api/jobs/:id/map.png (disajikan dari outputDir job).
    const mapM = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/map\.png$/);
    if (req.method === "GET" && mapM) {
      const jr = await fetch(`${GENERATOR}/jobs/${mapM[1]}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
      if (!jr.ok) return json(res, 404, { error: "job not found" });
      const job = await jr.json();
      const dir = safeWorldDir(job.outputDir);
      if (!dir) return json(res, 404, { error: "output dir tidak valid / belum siap" });
      try {
        const png = await readFile(join(WEB_ROOT, dir, "map.png"));
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
        return res.end(png);
      } catch {
        return json(res, 404, { error: "map.png belum ada untuk job ini" });
      }
    }

    // Meta peta hasil generate: /api/jobs/:id/meta (index.json -> dimensi world + preview flag).
    const metaM = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/meta$/);
    if (req.method === "GET" && metaM) {
      const jr = await fetch(`${GENERATOR}/jobs/${metaM[1]}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
      if (!jr.ok) return json(res, 404, { error: "job not found" });
      const job = await jr.json();
      const dir = safeWorldDir(job.outputDir);
      if (!dir) return json(res, 200, { job: job.id, ready: false, outputDir: job.outputDir || null });
      let meta = null;
      let hasMap = false;
      try { meta = JSON.parse(await readFile(join(WEB_ROOT, dir, "index.json"), "utf8")); } catch { meta = null; }
      try { await readFile(join(WEB_ROOT, dir, "map.png")); hasMap = true; } catch { hasMap = false; }
      return json(res, 200, {
        job: job.id,
        ready: Boolean(meta && hasMap),
        hasMap,
        worldVersion: meta?.worldVersion ?? null,
        worldChunks: meta?.worldChunks ?? null,
        worldSize: meta?.worldSize ?? null,
        mapUrl: hasMap ? `/api/jobs/${job.id}/map.png` : null,
      });
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

server.listen(PORT, HOST, () => {
  console.log(`geo-dashboard listening on http://${HOST}:${PORT} -> ${GENERATOR} (auth: ${AUTH_ON ? "on" : "off"})`);
  if (!AUTH_ON && HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.warn("[dashboard] PERINGATAN: bind non-loopback tanpa DASH_USER/DASH_PASS_HASH — jangan diekspos ke jaringan.");
  }
});
