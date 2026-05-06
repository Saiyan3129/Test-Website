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
const label = process.argv[3] || "";

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

const filename = label ? `screenshot-${nextN}-${label}.png` : `screenshot-${nextN}.png`;
const outPath = join(outDir, filename);

const browser = await puppeteer.launch({
  headless: "new",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle0", timeout: 120_000 });
// Scroll the page to bottom and back to trigger any progressive loading, then settle
await page.evaluate(async () => {
  const total = document.body.scrollHeight;
  for (let y = 0; y <= total; y += 800) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 80));
  }
  window.scrollTo(0, 0);
});
await new Promise(r => setTimeout(r, 4000));
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log(`Saved ${outPath}`);