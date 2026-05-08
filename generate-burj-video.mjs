// Generate a cinematic blueprint→photoreal transition video of the Burj Khalifa
// using kie.ai Kling 3.0 (start frame + end frame). Saves MP4 into ./videos/.
//
// Uses the KIE_API_KEY from .env directly (does NOT go through serve.mjs).

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

// --- env -------------------------------------------------------------------
function loadEnv() {
  const envPath = './.env';
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv();

const KIE_KEY = process.env.KIE_API_KEY || '';
if (!KIE_KEY) { console.error('KIE_API_KEY missing in .env'); process.exit(1); }

const UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';
const TASK_URL = 'https://api.kie.ai/api/v1/jobs/createTask';
const POLL_URL = 'https://api.kie.ai/api/v1/jobs/recordInfo';

const START_IMG = './images/burj-khalifa/burj-blueprint.png';
const END_IMG = './images/burj-khalifa/burj-rendered.png';
const OUT_DIR = './videos';
const OUT_FILE = path.join(OUT_DIR, 'burj-transformation.mp4');

const PROMPT = [
  'Cinematic transformation sequence: the camera slowly pushes in as a technical blueprint drawing comes to life',
  'Crisp blue schematic lines and grid markings begin to glow softly, then dissolve into volumetric form',
  'Materials, textures, lighting, and color emerge progressively',
  'wireframe edges fill with surfaces, shadows develop, and reflections sharpen',
  'The scene morphs seamlessly from flat 2D blueprint to a fully realized photorealistic 3D design of the Burj Khalifa',
  'Smooth motion, professional product reveal, soft cinematic lighting, no abrupt cuts, continuous camera movement',
].join('. ');

fs.mkdirSync(OUT_DIR, { recursive: true });

// --- helpers ---------------------------------------------------------------
async function uploadImage(localPath, fileName) {
  const buf = fs.readFileSync(localPath);
  const base64 = `data:image/png;base64,${buf.toString('base64')}`;
  console.log(`  uploading ${localPath} (${(buf.length / 1024).toFixed(0)} KB)…`);

  const r = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KIE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base64Data: base64,
      uploadPath: 'images/user-uploads',
      fileName,
    }),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`upload non-JSON: ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`upload HTTP ${r.status}: ${JSON.stringify(json).slice(0, 240)}`);
  const url = json?.data?.downloadUrl || json?.downloadUrl;
  if (!url) throw new Error(`upload no downloadUrl: ${JSON.stringify(json).slice(0, 240)}`);
  console.log(`    -> ${url}`);
  return url;
}

async function createTask(startUrl, endUrl) {
  const body = {
    model: 'kling-3.0/video',
    input: {
      prompt: PROMPT,
      image_urls: [startUrl, endUrl],
      sound: false,
      duration: '10',
      mode: 'pro',
      multi_shots: false,
    },
  };
  console.log('  creating Kling 3.0 task (10s, pro)…');
  const r = await fetch(TASK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KIE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`createTask non-JSON: ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`createTask HTTP ${r.status}: ${JSON.stringify(json).slice(0, 280)}`);
  const taskId = json?.data?.taskId;
  if (!taskId) throw new Error(`no taskId: ${JSON.stringify(json).slice(0, 280)}`);
  console.log(`    -> taskId=${taskId}`);
  return taskId;
}

function extractUrls(resultJson) {
  if (!resultJson) return [];
  try {
    const parsed = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson;
    const u = parsed?.resultUrls || parsed?.result_urls || parsed?.urls || parsed?.videoUrls || [];
    return Array.isArray(u) ? u.filter(Boolean) : [];
  } catch { return []; }
}

async function pollTask(taskId) {
  const started = Date.now();
  let delay = 4000;
  let lastState = '';
  while (Date.now() - started < 12 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, delay));
    const r = await fetch(`${POLL_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_KEY}` },
    });
    const json = await r.json().catch(() => ({}));
    const data = json?.data || {};
    const state = (data.state || '').toLowerCase();
    if (state !== lastState) {
      const elapsed = Math.round((Date.now() - started) / 1000);
      console.log(`    state=${state || 'queued'} (${elapsed}s)`);
      lastState = state;
    }
    if (state === 'success' || data.resultJson) {
      const urls = extractUrls(data.resultJson);
      if (urls.length) return urls[0];
    }
    if (state === 'fail' || state === 'failed' || data.failCode) {
      throw new Error(data.failMsg || `failed (${data.failCode || 'unknown'})`);
    }
    delay = Math.min(delay + 1000, 8000);
  }
  throw new Error('timeout after 12 minutes');
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); try { fs.unlinkSync(dest); } catch {}
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close(); try { fs.unlinkSync(dest); } catch {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(true)));
    }).on('error', (e) => { file.close(); try { fs.unlinkSync(dest); } catch {}; reject(e); });
  });
}

// --- main ------------------------------------------------------------------
(async () => {
  if (fs.existsSync(OUT_FILE) && fs.statSync(OUT_FILE).size > 50_000) {
    console.log(`~ ${OUT_FILE} already exists (${fs.statSync(OUT_FILE).size} bytes) — delete it to regenerate`);
    return;
  }

  console.log('1) uploading source frames…');
  const [startUrl, endUrl] = await Promise.all([
    uploadImage(START_IMG, 'burj-blueprint.png'),
    uploadImage(END_IMG, 'burj-rendered.png'),
  ]);

  console.log('\n2) submitting video task…');
  const taskId = await createTask(startUrl, endUrl);

  console.log('\n3) polling for completion…');
  const videoUrl = await pollTask(taskId);
  console.log(`    video ready: ${videoUrl}`);

  console.log('\n4) downloading…');
  await download(videoUrl, OUT_FILE);
  const size = fs.statSync(OUT_FILE).size;
  console.log(`\nDone. saved ${OUT_FILE} (${(size / 1024 / 1024).toFixed(2)} MB)`);
})().catch((e) => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});