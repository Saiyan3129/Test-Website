// Generate the gaming-console hero video via kie.ai (veo-3-fast).
// Saves to videos/console-hero.mp4 (or .webm depending on response).
//
// Usage: node generate-console-video.mjs

import fs from 'node:fs';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

// --- .env loader (no dependency) --------------------------------------------
const envPath = path.resolve('.env');
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const KIE_KEY = process.env.KIE_API_KEY;
if (!KIE_KEY) {
  console.error('Missing KIE_API_KEY in .env');
  process.exit(1);
}

const BASE = 'https://api.kie.ai/api/v1';
// Veo has a dedicated endpoint family on kie.ai (not the unified /jobs/createTask).
// model values: "veo3" (high quality) or "veo3_fast" (faster / cheaper)
const MODEL = process.env.KIE_VIDEO_MODEL || 'veo3_fast';

const PROMPT = [
  'A next-generation gaming console sits center-frame on a glossy black surface,',
  'slowly rotating to reveal sculpted curves and glowing accent lighting.',
  'RGB underglow pulses softly in cyan and magenta, reflecting on the floor below.',
  'A sleek game controller rests beside the console, buttons catching subtle highlights.',
  'Cinematic studio lighting with strong key light and rim light.',
  'Shallow depth of field, dark gradient background with faint particle effects floating in the air.',
  'Premium product reveal aesthetic, 4K hyperreal quality, no text, no logos, no watermarks.',
].join(' ');

const OUT_DIR = path.resolve('videos');
fs.mkdirSync(OUT_DIR, { recursive: true });

const headers = {
  Authorization: `Bearer ${KIE_KEY}`,
  'Content-Type': 'application/json',
};

async function createTask() {
  const body = {
    prompt: PROMPT,
    model: MODEL,
    aspectRatio: '16:9',
    enableFallback: true,
    enableTranslation: true,
  };
  const r = await fetch(`${BASE}/veo/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || j?.code !== 200) {
    console.error('createTask failed', r.status, JSON.stringify(j, null, 2));
    process.exit(1);
  }
  const taskId = j?.data?.taskId || j?.data?.task_id;
  if (!taskId) {
    console.error('No taskId in response', j);
    process.exit(1);
  }
  return taskId;
}

async function pollTask(taskId) {
  const start = Date.now();
  const timeoutMs = 12 * 60 * 1000;

  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`${BASE}/veo/record-info?taskId=${encodeURIComponent(taskId)}`, { headers });
    const j = await r.json();
    const data = j?.data || {};
    // Veo returns successFlag: 0 (in-progress), 1 (success), 2/3 (failed)
    const flag = data.successFlag;
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[${elapsed}s] successFlag=${flag} ${data.errorMessage ? '· ' + data.errorMessage : ''}`);

    if (flag === 1) {
      const resp = data.response || {};
      const urls = []
        .concat(resp.resultUrls || [])
        .concat(resp.originUrls || []);
      const url = urls.find(u => typeof u === 'string' && u.startsWith('http'));
      if (!url) {
        console.error('No video URL in success response', JSON.stringify(j, null, 2));
        process.exit(1);
      }
      return url;
    }

    if (flag === 2 || flag === 3) {
      console.error('Generation failed', JSON.stringify(j, null, 2));
      process.exit(1);
    }

    await new Promise(r => setTimeout(r, 8000));
  }
  console.error('Timed out after 12 minutes');
  process.exit(1);
}

async function downloadTo(url, outPath) {
  console.log(`Downloading ${url}`);
  const r = await fetch(url);
  if (!r.ok) {
    console.error('Download failed', r.status);
    process.exit(1);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  console.log(`Saved ${outPath} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}

(async () => {
  console.log(`Model: ${MODEL}`);
  const taskId = await createTask();
  console.log(`taskId: ${taskId}`);
  const url = await pollTask(taskId);

  const ext = (() => {
    try { return path.extname(new URL(url).pathname).toLowerCase() || '.mp4'; }
    catch { return '.mp4'; }
  })();
  const out = path.join(OUT_DIR, `console-hero${ext}`);
  await downloadTo(url, out);
  console.log('Done');
})();