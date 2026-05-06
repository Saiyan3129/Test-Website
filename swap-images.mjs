import fs from 'fs';

const file = 'index.html';
let html = fs.readFileSync(file, 'utf8');

const imgRegex = /src="(?:data:image\/svg\+xml;utf8,<svg[^"]+|https:\/\/loremflickr\.com\/[^"]+)"(?: referrerpolicy="no-referrer")?/;

// Local shoe images (40 slots in document order)
const slots = [
  // Hero (split)
  'images/shoes/hero-l.jpg',
  'images/shoes/hero-r.jpg',
  // Plus Court grid (5 sneakers)
  'images/shoes/sneaker-02.jpg',
  'images/shoes/sneaker-03.jpg',
  'images/shoes/sneaker-04.jpg',
  'images/shoes/sneaker-06.jpg',
  'images/shoes/sneaker-07.jpg',
  // Ezra feature (2 loafers)
  'images/shoes/shoe-01.jpg',
  'images/shoes/shoe-02.jpg',
  // Ezra grid (5 loafers)
  'images/shoes/shoe-03.jpg',
  'images/shoes/shoe-04.jpg',
  'images/shoes/shoe-05.jpg',
  'images/shoes/shoe-06.jpg',
  'images/shoes/shoe-07.jpg',
  // LDN II NYC feature
  'images/shoes/lifestyle-01.jpg',
  // NY grid (5)
  'images/shoes/shoe-08.jpg',
  'images/shoes/boot-02.jpg',
  'images/shoes/boot-03.jpg',
  'images/shoes/sneaker-01.jpg',
  'images/shoes/shoe-04.jpg',
  // Two-model split (2)
  'images/shoes/lifestyle-02.jpg',
  'images/shoes/lifestyle-03.jpg',
  // Best sellers 6 (loafers row)
  'images/shoes/shoe-01.jpg',
  'images/shoes/shoe-02.jpg',
  'images/shoes/shoe-03.jpg',
  'images/shoes/shoe-04.jpg',
  'images/shoes/shoe-05.jpg',
  'images/shoes/shoe-06.jpg',
  // Best sellers grid (5)
  'images/shoes/shoe-07.jpg',
  'images/shoes/shoe-08.jpg',
  'images/shoes/boot-02.jpg',
  'images/shoes/boot-03.jpg',
  'images/shoes/shoe-01.jpg',
  // Co-labs / Accessories (2)
  'images/shoes/lifestyle-05.jpg',
  'images/shoes/lifestyle-06.jpg',
  // Final grid (5)
  'images/shoes/shoe-02.jpg',
  'images/shoes/shoe-03.jpg',
  'images/shoes/sneaker-02.jpg',
  'images/shoes/sneaker-04.jpg',
  'images/shoes/tee-01.jpg',
];

let i = 0;
while (imgRegex.test(html)) {
  if (i >= slots.length) break;
  html = html.replace(imgRegex, `src="${slots[i]}"`);
  i++;
}

// Also rewire the Atelier collab section image to a local lifestyle image
html = html.replace(
  /src="https:\/\/loremflickr\.com\/2400\/1200\/man,coat,studio\?lock=91" referrerpolicy="no-referrer"/,
  'src="images/shoes/lifestyle-07.jpg"'
);

fs.writeFileSync(file, html);
console.log('Replaced', i, 'image sources with local files.');