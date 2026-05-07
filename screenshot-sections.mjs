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
const labelPrefix = process.argv[3] || "section";

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

const browser = await puppeteer.launch({
  headless: "new",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle0", timeout: 120_000 });

// Scroll to load all content
await page.evaluate(async () => {
  const total = document.body.scrollHeight;
  for (let y = 0; y <= total; y += 400) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 100));
  }
  window.scrollTo(0, 0);
});
await new Promise(r => setTimeout(r, 2000));

const totalHeight = await page.evaluate(() => document.body.scrollHeight);
const viewportH = 900;
const numShots = Math.ceil(totalHeight / viewportH);
console.log(`Total height: ${totalHeight}, taking ${numShots} viewport shots`);

for (let i = 0; i < numShots; i++) {
  const scrollY = i * viewportH;
  await page.evaluate(y => window.scrollTo(0, y), scrollY);
  await new Promise(r => setTimeout(r, 350));
  const filename = `screenshot-${nextN}-${labelPrefix}-${String(i + 1).padStart(2, "0")}.png`;
  const outPath = join(outDir, filename);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`Saved ${outPath}`);
  nextN++;
}

await browser.close();