// Generate two Burj Khalifa images via the local kie.ai proxy
// (serve.mjs must be running on :3000). Saves to images/burj-khalifa/.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const BASE = 'http://localhost:3000';
const OUT = './images/burj-khalifa';
fs.mkdirSync(OUT, { recursive: true });

const MODEL = 'google/nano-banana';

const JOBS = [
  {
    file: 'burj-blueprint.png',
    ratio: '3:4',
    prompt: [
      'Architectural blueprint line-art elevation drawing of the Burj Khalifa skyscraper in Dubai',
      'pure technical line drawing, crisp white linework on a deep cyan-blue blueprint paper background (#0d3b6f to #0a2a5a)',
      'thin precise white lines, faint grid behind the structure, dimension lines and tick marks at the base',
      'tiered setback geometry visible — Y-shaped tri-axial floor plan inset at corner',
      'measurement annotations rendered as fine illegible technical hatching, no readable text',
      'small north arrow and scale bar in the corner',
      'centered orthographic front elevation of the full tower from base to spire',
      'high contrast, no photorealism, schematic, drafting style, perfectly straight lines',
      'no people, no clouds, no color besides blueprint blue and white',
    ].join(', '),
  },
  {
    file: 'burj-rendered.png',
    ratio: '3:4',
    prompt: [
      'Photorealistic completed Burj Khalifa skyscraper in Dubai at golden hour',
      'full tower visible from base to spire, centered orthographic-style hero shot',
      'gleaming silver-blue glass and steel facade catching warm sunset light',
      'tiered setback architecture, Y-shaped floor plan visible, slender spire piercing the sky',
      'soft warm haze, subtle desert dust in air, distant city skyline far below',
      'clear gradient sky from deep blue at top to warm peach near horizon',
      'cinematic architectural photography, sharp focus on the tower, slight tilt-shift base softness',
      'editorial premium quality, ultra detailed glass mullions, no text, no watermark, no logo',
    ].join(', '),
  },
];

function postJSON(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      `${BASE}${urlPath}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
          catch (e) { reject(new Error(`Bad JSON from ${urlPath}: ${text.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJSON(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${urlPath}`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch (e) { reject(new Error(`Bad JSON from ${urlPath}: ${text.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(dest);
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close(); try { fs.unlinkSync(dest); } catch {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(true)));
    }).on('error', (e) => {
      file.close(); try { fs.unlinkSync(dest); } catch {}
      reject(e);
    });
  });
}

function extractUrls(resultJson) {
  if (!resultJson) return [];
  try {
    const parsed = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson;
    const u = parsed?.resultUrls || parsed?.result_urls || parsed?.urls || [];
    return Array.isArray(u) ? u.filter(Boolean) : [];
  } catch { return []; }
}

async function poll(taskId, label) {
  const started = Date.now();
  let delay = 1500;
  while (Date.now() - started < 5 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, delay));
    const { json } = await getJSON(`/api/kie/task?taskId=${encodeURIComponent(taskId)}`);
    const data = json?.data || {};
    const state = (data.state || '').toLowerCase();
    if (state === 'success' || data.resultJson) {
      const urls = extractUrls(data.resultJson);
      if (urls.length) return urls[0];
    }
    if (state === 'fail' || state === 'failed' || data.failCode) {
      throw new Error(data.failMsg || `failed (${data.failCode || 'unknown'})`);
    }
    process.stdout.write(`    ${label}: ${state || 'queued'} (${Math.round((Date.now() - started) / 1000)}s)\r`);
    delay = Math.min(delay + 300, 3500);
  }
  throw new Error('timeout');
}

async function generate(job) {
  const dest = path.join(OUT, job.file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 5000) {
    console.log(`  ~ ${job.file} cached (${fs.statSync(dest).size} bytes)`);
    return { ok: true, cached: true };
  }
  console.log(`\n  > ${job.file}  [${job.ratio}]`);
  const create = await postJSON('/api/kie/generate', {
    prompt: job.prompt,
    model: MODEL,
    image_size: job.ratio,
    output_format: 'png',
  });
  if (create.status !== 200) {
    console.log(`    ! create failed: ${JSON.stringify(create.json).slice(0, 200)}`);
    return { ok: false };
  }
  const taskId = create.json?.data?.taskId;
  if (!taskId) {
    console.log(`    ! no taskId: ${JSON.stringify(create.json).slice(0, 200)}`);
    return { ok: false };
  }
  try {
    const url = await poll(taskId, job.file);
    console.log(`\n    downloading…`);
    await download(url, dest);
    const size = fs.statSync(dest).size;
    console.log(`    ok ${job.file} (${size} bytes)`);
    return { ok: true };
  } catch (e) {
    console.log(`\n    ! ${job.file}: ${e.message}`);
    return { ok: false };
  }
}

(async () => {
  const cfg = await getJSON('/api/kie/config');
  if (!cfg.json?.hasKey) { console.error('KIE key missing on server'); process.exit(1); }
  console.log(`server ok — model=${MODEL}, jobs=${JOBS.length}`);

  let ok = 0, fail = 0;
  for (const job of JOBS) {
    const r = await generate(job);
    if (r.ok) ok++; else fail++;
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
})();