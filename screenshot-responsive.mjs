import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PUPPETEER_PATH = "C:/Users/nateh/AppData/Local/Temp/puppeteer-test/node_modules/puppeteer";
const FALLBACK = "puppeteer";

let puppeteer;
try {
  puppeteer = (await import(PUPPETEER_PATH)).default;
} catch {
  puppeteer = (await import(FALLBACK)).default;
}

const url = process.argv[2] || "http://localhost:3000";
const labelPrefix = process.argv[3] || "rwd";

const outDir = "./temporary screenshots";
if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

let nextN = 1;
try {
  const files = await readdir(outDir);
  const used = files
    .map(f => f.match(/^screenshot-(\d+)/))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10));
  if (used.length) nextN = Math.max(...used) + 1;
} catch {}

// Three breakpoints: mobile (iPhone-ish), tablet (iPad portrait), desktop (1440)
const viewports = [
  { name: "mobile",  width: 390, height: 844, vh: 844 },
  { name: "tablet",  width: 768, height: 1024, vh: 1024 },
  { name: "desktop", width: 1440, height: 900, vh: 900 },
];

const browser = await puppeteer.launch({ headless: "new" });

for (const vp of viewports) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120_000 });

  // Force light mode by clearing localStorage and reloading
  // Actually, we'll respect whatever the page chose, but capture both modes for desktop
  await page.evaluate(async () => {
    const total = document.body.scrollHeight;
    for (let y = 0; y <= total; y += 400) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await new Promise(r => setTimeout(r, 1500));

  const totalHeight = await page.evaluate(() => document.body.scrollHeight);
  const numShots = Math.ceil(totalHeight / vp.vh);
  console.log(`[${vp.name} ${vp.width}x${vp.height}] total=${totalHeight} shots=${numShots}`);

  for (let i = 0; i < numShots; i++) {
    const scrollY = i * vp.vh;
    await page.evaluate(y => window.scrollTo(0, y), scrollY);
    await new Promise(r => setTimeout(r, 300));
    const filename = `screenshot-${nextN}-${labelPrefix}-${vp.name}-${String(i + 1).padStart(2, "0")}.png`;
    const outPath = join(outDir, filename);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`  saved ${outPath}`);
    nextN++;
  }

  await page.close();
}

await browser.close();