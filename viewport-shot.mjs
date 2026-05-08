import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PUPPETEER_PATH = "C:/Users/nateh/AppData/Local/Temp/puppeteer-test/node_modules/puppeteer";
let puppeteer;
try {
  puppeteer = (await import(PUPPETEER_PATH)).default;
} catch {
  puppeteer = (await import("puppeteer")).default;
}

const url = process.argv[2] || "http://localhost:3000";
const label = process.argv[3] || "viewport";
const scrollY = parseInt(process.argv[4] || "0", 10);
const w = parseInt(process.argv[5] || "1440", 10);
const h = parseInt(process.argv[6] || "900", 10);

const outDir = "./temporary screenshots";
if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });
let nextN = 1;
try {
  const files = await readdir(outDir);
  const used = files.map(f => f.match(/^screenshot-(\d+)/)).filter(Boolean).map(m => parseInt(m[1], 10));
  if (used.length) nextN = Math.max(...used) + 1;
} catch {}
const outPath = join(outDir, `screenshot-${nextN}-${label}.png`);

const browser = await puppeteer.launch({
  headless: "new",
  defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle0", timeout: 120_000 });
await new Promise(r => setTimeout(r, 2500));
if (scrollY > 0) await page.evaluate(y => window.scrollTo(0, y), scrollY);
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: outPath, fullPage: false });
await browser.close();
console.log(`Saved ${outPath}`);