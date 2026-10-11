// Geo-map generator service. Port terpisah dari game & dashboard.
// Zero dependency: Node built-in only. Semua endpoint tulis butuh token admin.
import http from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.GEO_PORT ?? 19100);
const HOST = process.env.GEO_HOST ?? "127.0.0.1";
const ADMIN_TOKEN_HASH = process.env.GEO_ADMIN_TOKEN_SHA256 ?? "";
const CACHE = process.env.GEO_CACHE ?? join(ROOT, "cache");
const OSM_API = "https://api.openstreetmap.org/api/0.6/map";
const MAX_BBOX_DEG2 = 0.0005; // ~2.3 km x 2.3 km per job; batas agar server tidak kebanjiran data
const jobs = new Map();

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

function isAdmin(req) {
  const header = req.headers.authorization ?? "";
  if (!ADMIN_TOKEN_HASH || !header.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice(7)).digest();
  const expected = Buffer.from(ADMIN_TOKEN_HASH, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function parseBbox(raw) {
  const parts = String(raw ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (!(w < e && s < n) || w < -180 || e > 180 || s < -90 || n > 90) return null;
  if ((e - w) * (n - s) > MAX_BBOX_DEG2) return null;
  return { w, s, e, n };
}

async function runJob(job) {
  job.status = "fetching";
  try {
    const { w, s, e, n } = job.bbox;
    const url = `${OSM_API}?bbox=${w},${s},${e},${n}`;
    const res = await fetch(url, { headers: { "User-Agent": "owc-geo-generator/0.1" }, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`OSM API HTTP ${res.status}`);
    const xml = Buffer.from(await res.arrayBuffer());
    await mkdir(join(CACHE, job.id), { recursive: true });
    const file = join(CACHE, job.id, "osm.xml");
    await writeFile(file, xml);
    job.osm = { file: `cache/${job.id}/osm.xml`, bytes: xml.length, sha256: createHash("sha256").update(xml).digest("hex") };
    job.status = "fetched"; // Fase 1 (convert + bake) menyusul di sini
  } catch (err) {
    job.status = "failed";
    job.error = String(err.message ?? err);
  }
  job.updatedAt = new Date().toISOString();
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error("body too large"); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "geo-generator", port: PORT });

    if (!isAdmin(req)) return json(res, req.headers.authorization ? 403 : 401, { error: "admin only" });

    if (req.method === "POST" && url.pathname === "/jobs") {
      let body;
      try { body = await readBody(req); } catch { return json(res, 400, { error: "invalid body" }); }
      const bbox = parseBbox(body.bbox);
      if (!bbox) return json(res, 400, { error: "bbox must be w,s,e,n (lon,lat), max ~2.3 km x 2.3 km" });
      const id = `job_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
      const job = { id, name: String(body.name ?? "unnamed").slice(0, 80), bbox, status: "queued", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      jobs.set(id, job);
      runJob(job); // async; status dipolling via GET /jobs/:id
      return json(res, 202, job);
    }

    const m = url.pathname.match(/^\/jobs\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const job = jobs.get(m[1]);
      return job ? json(res, 200, job) : json(res, 404, { error: "not found" });
    }
    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error("[500]", req.method, url.pathname, err && err.stack ? err.stack : err);
    return json(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, HOST, () => console.log(`geo-generator listening on http://${HOST}:${PORT}`));
