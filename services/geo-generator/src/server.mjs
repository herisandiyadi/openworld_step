// Geo-map generator service. Port terpisah dari game & dashboard.
// Zero dependency: Node built-in only. Semua endpoint tulis butuh token admin.
import http from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rename, cp, rm, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.GEO_PORT || 19100);
const HOST = process.env.GEO_HOST || "127.0.0.1";
const ADMIN_TOKEN_HASH = process.env.GEO_ADMIN_TOKEN_SHA256 || "";
const CACHE = process.env.GEO_CACHE || join(ROOT, "cache");
const OSM_API = "https://api.openstreetmap.org/api/0.6/map";
const MAX_BBOX_DEG2 = 0.0005; // ~2.3 km x 2.3 km per job; batas agar server tidak kebanjiran data
const JOBS_FILE = join(CACHE, "jobs.json");
const jobs = new Map();
// World aktif yang dibaca game (hardcoded di src/world/worldState.ts: public/world/).
const WEB_ROOT = process.env.GEO_WEB_ROOT || join(ROOT, "..", "..", "web");
const ACTIVE_WORLD_DIR = join(WEB_ROOT, "public", "world");
const WORLD_DIR_RE = /^public\/world-([a-z0-9_-]+)$/i;

/** Validasi outputDir job -> path relatif aman "public/world-<slug>". */
function safeWorldDir(outputDir) {
  if (typeof outputDir !== "string") return null;
  const norm = normalize(outputDir).replace(/\\/g, "/");
  if (!WORLD_DIR_RE.test(norm) || norm.includes("..")) return null;
  return norm;
}

async function loadJobs() {
  try {
    const arr = JSON.parse(await readFile(JOBS_FILE, "utf8"));
    for (const j of arr) jobs.set(j.id, j);
  } catch { /* first run: belum ada file */ }
}
async function saveJobs() {
  await writeFile(JOBS_FILE + ".tmp", JSON.stringify(Array.from(jobs.values()), null, 2));
  await rename(JOBS_FILE + ".tmp", JOBS_FILE);
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

function isAdmin(req) {
  const header = req.headers.authorization || "";
  if (!ADMIN_TOKEN_HASH || !header.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice(7)).digest();
  const expected = Buffer.from(ADMIN_TOKEN_HASH, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function parseBbox(raw) {
  const parts = String(raw || "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (!(w < e && s < n) || w < -180 || e > 180 || s < -90 || n > 90) return null;
  if ((e - w) * (n - s) > MAX_BBOX_DEG2) return null;
  return { w, s, e, n };
}

/** Build content-update manifest untuk peta selesai dibake. Best-effort: gagal tidak menggagalkan job. */
async function buildMapPack() {
  const WEB = join(ROOT, "..", "..", "web");
  const args = [join(WEB, "node_modules", "vite-node", "vite-node.mjs"), join(WEB, "tools", "geo", "map-pack.mjs")];
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, args, {
      cwd: WEB,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MAP_PACK_RUN: "1",
        CONTENT_SIGNING_KEY_ID: process.env.MAP_PACK_KEY_ID,
        CONTENT_SIGNING_PRIVATE_KEY: process.env.MAP_PACK_PRIVATE_KEY,
        CONTENT_SIGNING_PRIVATE_KEY_FILE: process.env.MAP_PACK_PRIVATE_KEY_FILE,
      },
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => resolveP(`spawn error: ${e}`));
    child.on("close", (code) => resolveP(code === 0 ? "ok" : `exit ${code}: ${err.slice(-300)}`));
  });
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
    job.status = "fetched";
    job.updatedAt = new Date().toISOString();

    // convert + bake: child node vite-node, cwd = web/
    job.status = "building";
    job.updatedAt = new Date().toISOString();
    const WEB = join(ROOT, "..", "..", "web");
    const buildArgs = [
      join(WEB, "node_modules", "vite-node", "vite-node.mjs"),
      join(WEB, "tools", "geo", "build.ts"),
      "--",
      "--xml", file,
      "--bbox", `${w},${s},${e},${n}`,
      "--name", job.name,
      "--chunks", String(job.chunks || 32),
      "--height", String(job.buildingHeight || 8),
    ];
    await new Promise((resolveP) => {
      const child = spawn(process.execPath, buildArgs, { cwd: WEB, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", (d) => { out += d.toString(); });
      child.stderr.on("data", (d) => { err += d.toString(); });
      child.on("error", (e2) => { job.status = "failed"; job.error = `spawn: ${e2}`; resolveP(); });
      child.on("close", (code, signal) => {
        if (code === 0) {
          job.status = "completed";
          job.outputDir = `public/world-${job.name}`;
          job.buildLog = out.trim().split("\n").slice(-8).join("\n");
        } else {
          job.status = "failed";
          job.error = `exit ${code ?? "null"} signal ${signal ?? "none"}: ${(err || out).slice(-600)}`;
        }
        job.updatedAt = new Date().toISOString();
        resolveP();
      });
    });
    await saveJobs();

    // Build map pack (content update manifest) - best effort, di luar callback spawn.
    if (job.status === "completed") {
      job.mapPack = await buildMapPack();
      job.updatedAt = new Date().toISOString();
      await saveJobs();
    }
  } catch (err) {
    job.status = "failed";
    job.error = String(err.message || err);
  }
  job.updatedAt = new Date().toISOString();
  await saveJobs();
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error("body too large"); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

/**
 * Jadikan output dunia milik job sebagai world aktif yang dibaca game.
 * Menyalin public/world-<slug>/ -> public/world/ secara atomik:
 * bangun di world.next/ lalu tukar, supaya game tidak pernah membaca world setengah jadi.
 * @returns {Promise<{activated:boolean, from?:string, to?:string, worldVersion?:string, worldChunks?:number}>}
 */
async function activateWorld(job) {
  const dir = safeWorldDir(job.outputDir);
  if (!dir) throw new Error("job belum punya output dunia yang valid (status harus completed)");
  const src = join(WEB_ROOT, dir);
  await access(join(src, "index.json")); // throw kalau output tidak lengkap

  const staging = join(WEB_ROOT, "public", "world.next");
  const backup = join(WEB_ROOT, "public", "world.prev");
  await rm(staging, { recursive: true, force: true });
  await cp(src, staging, { recursive: true });
  await access(join(staging, "index.json")); // pastikan salinan utuh sebelum tukar

  await rm(backup, { recursive: true, force: true });
  try {
    await rename(ACTIVE_WORLD_DIR, backup); // simpan world lama sebagai rollback
  } catch { /* belum ada world aktif: tidak masalah */ }
  await rename(staging, ACTIVE_WORLD_DIR);
  await rm(backup, { recursive: true, force: true });

  const index = JSON.parse(await readFile(join(ACTIVE_WORLD_DIR, "index.json"), "utf8"));
  return {
    activated: true,
    from: dir,
    to: "public/world",
    worldVersion: index.worldVersion,
    worldChunks: index.worldChunks,
    worldSize: index.worldSize,
  };
}

await loadJobs();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "geo-generator", port: PORT });

    if (!isAdmin(req)) return json(res, req.headers.authorization ? 403 : 401, { error: "admin only" });

    if (req.method === "POST" && url.pathname === "/jobs") {
      let body;
      try { body = await readBody(req); } catch { return json(res, 400, { error: "invalid body" }); }
      const bbox = parseBbox(body.bbox);
      if (!bbox) return json(res, 400, { error: "bbox must be w,s,e,n (lon,lat), max ~2.3 km x 2.3 km" });
      const id = `job_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
      const job = { id, name: String(body.name || "unnamed").slice(0, 80), bbox, status: "queued", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), chunks: body.chunks || 32, buildingHeight: body.buildingHeight || 8 };
      jobs.set(id, job);
      await saveJobs();
      runJob(job); // async; status dipolling via GET /jobs/:id
      return json(res, 202, job);
    }

    if (req.method === "GET" && url.pathname === "/jobs") {
      const list = Array.from(jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(res, 200, list);
    }
    const m = url.pathname.match(/^\/jobs\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const job = jobs.get(m[1]);
      return job ? json(res, 200, job) : json(res, 404, { error: "not found" });
    }

    // Aktifkan output job sebagai world yang dibaca game (public/world/).
    const act = url.pathname.match(/^\/jobs\/([\w-]+)\/activate$/);
    if (req.method === "POST" && act) {
      const job = jobs.get(act[1]);
      if (!job) return json(res, 404, { error: "not found" });
      if (job.status !== "completed") return json(res, 409, { error: `job status: ${job.status}` });
      try {
        const result = await activateWorld(job);
        job.activatedAt = new Date().toISOString();
        job.active = true;
        await saveJobs();
        console.log(`[activate] ${job.id} (${job.name}) -> public/world`);
        return json(res, 200, { ok: true, job: job.id, name: job.name, ...result });
      } catch (err) {
        return json(res, 400, { error: String(err.message || err) });
      }
    }
    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error("[500]", req.method, url.pathname, err && err.stack ? err.stack : err);
    return json(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, HOST, () => console.log(`geo-generator listening on http://${HOST}:${PORT}`));
