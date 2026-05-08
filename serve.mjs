import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { existsSync, statSync, readFileSync } from "node:fs";

const ROOT = resolve(".");
const PORT = 3000;

// --- .env loader (no dependency) ---------------------------------------------
function loadEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const KIE_BASE = "https://api.kie.ai/api/v1";
const KIE_KEY = process.env.KIE_API_KEY || "";
const KIE_DEFAULT_MODEL = process.env.KIE_DEFAULT_MODEL || "google/nano-banana";

// --- helpers ----------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function kieFetch(path, init = {}) {
  if (!KIE_KEY) {
    return { ok: false, status: 500, body: { error: "KIE_API_KEY missing on server" } };
  }
  const r = await fetch(`${KIE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KIE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  let body;
  try { body = await r.json(); } catch { body = { error: "Non-JSON response from kie.ai" }; }
  return { ok: r.ok, status: r.status, body };
}

// --- routes -----------------------------------------------------------------
async function handleApi(req, res, urlPath, urlObj) {
  // POST /api/kie/generate { prompt, model?, image_size?, output_format?, image_urls? }
  if (urlPath === "/api/kie/generate" && req.method === "POST") {
    let payload;
    try { payload = JSON.parse(await readBody(req) || "{}"); }
    catch { return sendJSON(res, 400, { error: "Invalid JSON body" }); }

    const prompt = (payload.prompt || "").toString().trim();
    if (!prompt) return sendJSON(res, 400, { error: "Missing 'prompt'" });

    const model = (payload.model || KIE_DEFAULT_MODEL).toString();
    const input = {
      prompt,
      output_format: payload.output_format || "png",
      image_size: payload.image_size || "1:1",
    };
    if (Array.isArray(payload.image_urls) && payload.image_urls.length) {
      input.image_urls = payload.image_urls;
    }

    const result = await kieFetch("/jobs/createTask", {
      method: "POST",
      body: JSON.stringify({ model, input }),
    });
    return sendJSON(res, result.ok ? 200 : result.status, result.body);
  }

  // GET /api/kie/task?taskId=...
  if (urlPath === "/api/kie/task" && req.method === "GET") {
    const taskId = urlObj.searchParams.get("taskId");
    if (!taskId) return sendJSON(res, 400, { error: "Missing 'taskId'" });
    const result = await kieFetch(`/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { method: "GET" });
    return sendJSON(res, result.ok ? 200 : result.status, result.body);
  }

  // GET /api/kie/config — non-secret config (default model, key presence)
  if (urlPath === "/api/kie/config" && req.method === "GET") {
    return sendJSON(res, 200, {
      hasKey: Boolean(KIE_KEY),
      defaultModel: KIE_DEFAULT_MODEL,
    });
  }

  return sendJSON(res, 404, { error: "Unknown API route" });
}

// --- server -----------------------------------------------------------------
const server = createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, "http://localhost");
    const urlPath = decodeURIComponent(urlObj.pathname);

    if (urlPath.startsWith("/api/")) {
      return await handleApi(req, res, urlPath, urlObj);
    }

    let filePath = join(ROOT, normalize(urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return;
    }
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error: " + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
  console.log(`kie.ai key: ${KIE_KEY ? "loaded" : "MISSING — set KIE_API_KEY in .env"}`);
});