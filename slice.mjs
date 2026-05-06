import fs from 'fs';
import path from 'path';

const PUPPETEER_PATH = "C:/Users/nateh/AppData/Local/Temp/puppeteer-test/node_modules/puppeteer";
let puppeteer;
try {
  puppeteer = (await import(PUPPETEER_PATH)).default;
} catch {
  puppeteer = (await import('puppeteer')).default;
}

const inputPath = process.argv[2] || './Screen Shot 2026-05-06 at 23.39.48-fullpage.png';
const outDir = './slices';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Read image as base64 data URL to avoid file:// path issues with spaces
const imgBuf = fs.readFileSync(inputPath);
const dataUrl = `data:image/png;base64,${imgBuf.toString('base64')}`;

// PNG dimensions
const width = imgBuf.readUInt32BE(16);
const height = imgBuf.readUInt32BE(20);
console.log(`Image: ${width}x${height}`);

const sliceCount = 8;
const sliceHeight = Math.ceil(height / sliceCount);

const browser = await puppeteer.launch({ headless: 'new' });

for (let i = 0; i < sliceCount; i++) {
  const y = i * sliceHeight;
  const h = Math.min(sliceHeight, height - y);
  const page = await browser.newPage();
  await page.setViewport({ width, height: h, deviceScaleFactor: 1 });
  const html = `<!doctype html><html><body style="margin:0;padding:0;overflow:hidden;">
    <img src="${dataUrl}" style="display:block;margin-top:${-y}px;width:${width}px;">
  </body></html>`;
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // Wait briefly for image to render
  await new Promise(r => setTimeout(r, 500));
  const outPath = path.join(outDir, `slice-${i + 1}.png`);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width, height: h } });
  console.log(`Wrote ${outPath} (y=${y}, h=${h})`);
  await page.close();
}

await browser.close();
console.log('Done.');