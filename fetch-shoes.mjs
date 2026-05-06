import fs from 'fs';
import path from 'path';
import https from 'https';

const outDir = './images/shoes';
fs.mkdirSync(outDir, { recursive: true });

// Verified Unsplash photo IDs (well-known shoe photography). Use Unsplash CDN with sizing query.
// If a fetch fails, we'll log it and continue.
const sources = [
  // sneakers
  ['sneaker-01.jpg', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=900&q=80'],
  ['sneaker-02.jpg', 'https://images.unsplash.com/photo-1556906781-9a412961c28c?w=900&q=80'],
  ['sneaker-03.jpg', 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=900&q=80'],
  ['sneaker-04.jpg', 'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=900&q=80'],
  ['sneaker-05.jpg', 'https://images.unsplash.com/photo-1597350584914-55ccf6d29eb1?w=900&q=80'],
  ['sneaker-06.jpg', 'https://images.unsplash.com/photo-1605408499391-6368c628ef42?w=900&q=80'],
  ['sneaker-07.jpg', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=900&q=80&hue=20'],
  // dress shoes / loafers
  ['shoe-01.jpg', 'https://images.unsplash.com/photo-1614253429340-98120bd6d753?w=900&q=80'],
  ['shoe-02.jpg', 'https://images.unsplash.com/photo-1582897085656-c636d006a246?w=900&q=80'],
  ['shoe-03.jpg', 'https://images.unsplash.com/photo-1605812860427-4024433a70fd?w=900&q=80'],
  ['shoe-04.jpg', 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=900&q=80'],
  ['shoe-05.jpg', 'https://images.unsplash.com/photo-1531310197839-ccf54634509e?w=900&q=80'],
  ['shoe-06.jpg', 'https://images.unsplash.com/photo-1533681904393-9ab6eee7e408?w=900&q=80'],
  ['shoe-07.jpg', 'https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?w=900&q=80'],
  ['shoe-08.jpg', 'https://images.unsplash.com/photo-1520639888713-7851133b1ed0?w=900&q=80'],
  // boots
  ['boot-01.jpg', 'https://images.unsplash.com/photo-1608256246200-53e8b47b2dc1?w=900&q=80'],
  ['boot-02.jpg', 'https://images.unsplash.com/photo-1511556820780-d912e42b4980?w=900&q=80'],
  ['boot-03.jpg', 'https://images.unsplash.com/photo-1542838686-37da4a9fd1b3?w=900&q=80'],
  // tshirts / accessories
  ['tee-01.jpg', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900&q=80'],
  // hero & lifestyle
  ['hero-l.jpg', 'https://images.unsplash.com/photo-1492447166138-50c3889fccb1?w=1400&q=80'],
  ['hero-r.jpg', 'https://images.unsplash.com/photo-1520975661595-6453be3f7070?w=1400&q=80'],
  ['lifestyle-01.jpg', 'https://images.unsplash.com/photo-1502716119720-b23a93e5fe1b?w=1400&q=80'],
  ['lifestyle-02.jpg', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1400&q=80'],
  ['lifestyle-03.jpg', 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1400&q=80'],
  ['lifestyle-04.jpg', 'https://images.unsplash.com/photo-1517440322747-32acdf6ad9e5?w=1400&q=80'],
  ['lifestyle-05.jpg', 'https://images.unsplash.com/photo-1483721310020-03333e577078?w=1400&q=80'],
  ['lifestyle-06.jpg', 'https://images.unsplash.com/photo-1516762689617-e1cffcef479d?w=1400&q=80'],
  ['lifestyle-07.jpg', 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=1400&q=80'],
  ['lifestyle-08.jpg', 'https://images.unsplash.com/photo-1488161628813-04466f872be2?w=1400&q=80'],
];

function fetch(url, dest) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        file.close();
        fs.unlinkSync(dest);
        return fetch(res.headers.location, dest).then(resolve);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        console.warn(`  ! ${dest}: HTTP ${res.statusCode}`);
        return resolve(false);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(() => resolve(true)); });
    });
    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      console.warn(`  ! ${dest}: ${err.message}`);
      resolve(false);
    });
    req.setTimeout(20000, () => { req.destroy(); });
  });
}

(async () => {
  let ok = 0, fail = 0;
  for (const [name, url] of sources) {
    const dest = path.join(outDir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      console.log(`  ~ ${name} (cached, ${fs.statSync(dest).size} bytes)`);
      ok++; continue;
    }
    process.stdout.write(`  > ${name} ... `);
    const success = await fetch(url, dest);
    if (success && fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      console.log(`ok (${fs.statSync(dest).size} bytes)`);
      ok++;
    } else {
      console.log('failed');
      fail++;
    }
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
})();