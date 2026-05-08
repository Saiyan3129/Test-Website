// Generate product + background images for TesterTech.html via the local
// kie.ai proxy (serve.mjs must be running on :3000). Saves to images/tech/.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const BASE = 'http://localhost:3000';
const OUT = './images/tech';
fs.mkdirSync(OUT, { recursive: true });

// Shared aesthetic — keep it consistent across all product shots.
const STYLE = [
  'editorial product photography',
  'cinematic studio lighting',
  'soft top-left key light, deep shadows',
  'matte dark graphite background (#0a0a0b to #1d1d23 gradient)',
  'subtle warm rim light',
  'accent of luminous lime-green (#d4ff3a) reflected on metal edges',
  'fine grain texture',
  'shallow depth of field, sharp on subject',
  'no text, no watermark, no logo',
  'high detail, premium luxury tech aesthetic',
].join(', ');

const BG_STYLE = [
  'abstract futuristic technology background',
  'macro detail of brushed titanium and circuitry',
  'extremely dark almost black graphite tones (#0a0a0b)',
  'subtle warm gold (#c6a559) and lime-green (#d4ff3a) accent highlights',
  'cinematic atmospheric lighting',
  'soft volumetric haze, light leaks',
  'fine grain, very low contrast, very dark, mostly black',
  'no text, no logo, abstract texture only',
].join(', ');

// model: 'google/nano-banana-pro' — better quality than fast variant
// (flux is even more photoreal but slower; using nano pro keeps a unified look)
const MODEL = 'google/nano-banana';

const JOBS = [
  // ---- products ----
  {
    file: 'ts01-hero.png',
    ratio: '4:5',
    prompt: `A single premium titanium smartwatch standing upright on a dark plinth, 42mm circular case, sapphire crystal face, minimal black dial with a thin lime-green accent index, integrated black titanium link bracelet, subtle edge highlights, three-quarter angle hero shot, cinematic mood. ${STYLE}.`,
  },
  {
    file: 'tester-one.png',
    ratio: '4:5',
    prompt: `A polished titanium luxury smartwatch laid on warm dark suede, 42mm round case, deep black ceramic bezel, minimal monochrome digital dial with a single lime-green status pip at twelve, integrated woven bracelet, top-down editorial angle. ${STYLE}.`,
  },
  {
    file: 'tester-lite.png',
    ratio: '4:5',
    prompt: `A slim minimalist aluminum smartwatch, 38mm round case, soft champagne-silver finish, simple black face with a thin warm-gold accent ring, fluoroelastomer cream-bone strap, three-quarter floating angle, soft shadow beneath. ${STYLE}.`,
  },
  {
    file: 'tester-field.png',
    ratio: '4:5',
    prompt: `A rugged tactical field smartwatch, 46mm titanium case with grade-5 brushed finish, knurled bezel, black PVD coating, military-spec ribbed strap in dark olive, dial showing compass and altimeter rings in muted tones with lime-green data highlights, dramatic side angle, MIL-STD aesthetic. ${STYLE}.`,
  },
  {
    file: 'tester-lens.png',
    ratio: '5:4',
    prompt: `A pair of sleek minimalist smart glasses, slim acetate frame in matte black with thin titanium temple arms, almost no bezel, micro projector hidden inside the temple, lenses with a faint warm tint and a subtle lime-green reflection across the corner, floating against a dark graphite backdrop, editorial side-front angle. ${STYLE}.`,
  },
  {
    file: 'tester-pulse.png',
    ratio: '1:1',
    prompt: `A cylindrical 360-degree smart speaker, brushed aluminum cabinet in warm graphite, knurled top dial, fabric mesh wrap with subtle weave detail, single thin lime-green light line glowing softly across the bottom edge, three-quarter angle, dramatic single-source studio lighting. ${STYLE}.`,
  },
  {
    file: 'tester-mini.png',
    ratio: '1:1',
    prompt: `A small portable voice puck, palm-sized matte titanium disc with a soft fabric top, single physical button, warm-gold accent ring around the side, sitting on a dark stone surface, minimalist, top-three-quarter angle. ${STYLE}.`,
  },
  {
    file: 'tester-ring.png',
    ratio: '1:1',
    prompt: `A premium smart ring, polished titanium band with a discreet warm-gold inner sleeve and inset health sensors visible from below, floating against dark graphite background, macro detail, jewelry photography quality. ${STYLE}.`,
  },
  {
    file: 'tester-buds.png',
    ratio: '1:1',
    prompt: `A pair of premium wireless earbuds resting on top of an aluminum charging case, cream-bone earbud bodies with brushed titanium stems and a single lime-green LED pinhole on the case, soft top-down hero composition. ${STYLE}.`,
  },
  {
    file: 'tester-pen.png',
    ratio: '1:1',
    prompt: `A sleek smart stylus pen, knurled titanium barrel with warm-gold bands at the tip and clip, soft rubber writing tip, resting at a slight diagonal on a dark notebook with subtle paper grain visible, editorial product still life. ${STYLE}.`,
  },
  {
    file: 'tester-tag.png',
    ratio: '1:1',
    prompt: `A small UWB tracker tag, round brushed-aluminum disc smaller than a coin, leather loop attached, single lime-green status dot recessed into the surface, floating against a dark graphite background with soft shadow. ${STYLE}.`,
  },

  // ---- backgrounds ----
  {
    file: 'bg-hero.png',
    ratio: '16:9',
    prompt: `Extremely dark abstract futuristic technology backdrop. Hints of brushed titanium grain and almost-invisible circuitry traces deep in shadow, faint vertical light shafts top-right with a barely-there lime-green tint, warm gold haze low-left, mostly pure black void. Mood is silent, atmospheric, premium. ${BG_STYLE}.`,
  },
  {
    file: 'bg-standards.png',
    ratio: '21:9',
    prompt: `A long horizontal abstract dark technology backdrop showing a wide blueprint-like grid of micro tick marks on a near-black surface, with a single thin glowing lime-green data line running through the lower third, very subtle warm gold highlights, cinematic vignette, mostly black. ${BG_STYLE}.`,
  },
  {
    file: 'bg-preorder.png',
    ratio: '16:9',
    prompt: `Abstract dark futuristic horizon: a deep graphite void with a glowing lime-green low arc near the bottom-right like a far horizon line, soft warm gold radial bloom in the upper-left corner, fine grain, atmospheric haze, cinematic premium tech vibe, mostly black with only subtle accents. ${BG_STYLE}.`,
  },
];

function postJSON(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      `${BASE}${urlPath}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      },
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
  // Quick sanity check
  const cfg = await getJSON('/api/kie/config');
  if (!cfg.json?.hasKey) { console.error('KIE key missing on server'); process.exit(1); }
  console.log(`server ok — model=${MODEL}, jobs=${JOBS.length}`);

  // Generate sequentially to avoid hammering the API
  let ok = 0, fail = 0;
  for (const job of JOBS) {
    const r = await generate(job);
    if (r.ok) ok++; else fail++;
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
})();