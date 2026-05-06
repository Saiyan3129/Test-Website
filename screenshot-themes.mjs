import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PUPPETEER_PATH = "C:/Users/nateh/AppData/Local/Temp/puppeteer-test/node_modules/puppeteer";
let puppeteer;
try { puppeteer = (await import(PUPPETEER_PATH)).default; }
catch { puppeteer = (await import('puppeteer')).default; }

const url = "http://localhost:3000";
const outDir = "./temporary screenshots";
if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

let nextN = 1;
try {
  const files = await readdir(outDir);
  const used = files.map(f => f.match(/^screenshot-(\d+)/)).filter(Boolean).map(m => parseInt(m[1], 10));
  if (used.length) nextN = Math.max(...used) + 1;
} catch {}

const browser = await puppeteer.launch({
  headless: 'new',
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});

for (const theme of ['light', 'dark']) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => {
    try { localStorage.setItem('theme', t); } catch (e) {}
  }, theme);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.evaluate(async () => {
    const total = document.body.scrollHeight;
    for (let y = 0; y <= total; y += 800) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await new Promise(r => setTimeout(r, 3000));
  const out = join(outDir, `screenshot-${nextN}-${theme}.png`);
  await page.screenshot({ path: out, fullPage: true });
  console.log('Saved', out);
  await page.close();
  nextN++;
}

await browser.close();