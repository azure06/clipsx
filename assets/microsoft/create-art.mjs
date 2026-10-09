import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/gabri/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json');
const sharp = require('sharp');
const here = path.dirname(fileURLToPath(import.meta.url));
const art = path.join(here, 'v2/art');
const upload = path.join(here, 'upload');
await fs.mkdir(art, { recursive: true });
await fs.mkdir(upload, { recursive: true });
const source = await fs.readFile(path.resolve(here, '../../../clipsx-web/src/components/brand/IconLab.tsx'), 'utf8');
const topPath = source.match(/const pathTop = "([^"]+)"/)[1];
const bottomPath = source.match(/const pathBottom = "([^"]+)"/)[1];
const variants = {
  brand: { top: ['#0086ff','#1170d1'], bottom: ['#0e86fd','#1770cf'], tile: ['#ffffff','#edf1f8'] },
  ink: { top: ['#334155','#172033'], bottom: ['#475569','#182238'], tile: ['#ffffff','#edf1f8'] },
};
const defs = (v) => `<linearGradient id="top" gradientUnits="userSpaceOnUse" x1="324" y1="940" x2="1592" y2="940"><stop stop-color="${v.top[0]}"/><stop offset="1" stop-color="${v.top[1]}"/></linearGradient><linearGradient id="bottom" gradientUnits="userSpaceOnUse" x1="324" y1="940" x2="1592" y2="940"><stop stop-color="${v.bottom[0]}"/><stop offset="1" stop-color="${v.bottom[1]}"/></linearGradient><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${v.tile[0]}"/><stop offset="1" stop-color="${v.tile[1]}"/></linearGradient>`;
const mark = `<path d="${topPath}" fill="url(#top)"/><path d="${bottomPath}" fill="url(#bottom)"/>`;
const icon = (id, size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1920 1920"><defs>${defs(variants[id])}</defs><rect width="1920" height="1920" fill="url(#tile)"/>${mark}</svg>`;
const toData = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;

for (const size of [1080,2160]) {
  const name = `box-art-brand-blue-${size}x${size}`;
  const svg = icon('brand', size);
  await fs.writeFile(path.join(art, `${name}.svg`), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(art, `${name}.png`));
  await fs.copyFile(path.join(art, `${name}.png`), path.join(upload, `${name}.png`));
}

const screenshot = await fs.readFile(path.join(here, 'v2/source-light-markdown-rounded.png'));
const {width,height} = await sharp(screenshot).metadata();
const appWidth = 1240;
const appHeight = appWidth * height / width;
const brandSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="300 320 1320 1240"><defs>${defs(variants.ink)}</defs>${mark}</svg>`;
const brand = await sharp(Buffer.from(brandSvg)).png().toBuffer();
const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="2160" viewBox="0 0 1440 2160">
<defs>
  <radialGradient id="violet"><stop stop-color="#b9a6ee" stop-opacity=".42"/><stop offset="1" stop-color="#b9a6ee" stop-opacity="0"/></radialGradient>
  <radialGradient id="cyan"><stop stop-color="#a2d9f0" stop-opacity=".65"/><stop offset="1" stop-color="#a2d9f0" stop-opacity="0"/></radialGradient>
  <linearGradient id="accent"><stop stop-color="#2398ed"/><stop offset="1" stop-color="#a08dff"/></linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#344c76" flood-opacity=".18"/></filter>
</defs>
<rect width="1440" height="2160" fill="#f5f8fe"/>
<ellipse cx="1180" cy="1300" rx="1000" ry="1050" fill="url(#violet)"/>
<ellipse cx="100" cy="1000" rx="900" ry="1200" fill="url(#cyan)"/>
<path d="M-140 1890 Q370 1240 1040 1610 T1660 1050" fill="none" stroke="#91a6cb" stroke-opacity=".16" stroke-width="2"/>
<image x="96" y="100" width="88" height="88" href="${toData(brand)}"/>
<g font-family="Segoe UI,sans-serif">
<text x="207" y="165" fill="#15213d" font-size="64" font-weight="700">ClipsX</text>
<rect x="100" y="282" width="54" height="5" rx="2" fill="url(#accent)"/>
<text x="175" y="295" fill="#6552b8" font-size="23" font-weight="600" letter-spacing="3">YOUR CLIPBOARD. MORE POSSIBILITIES.</text>
<text x="96" y="420" fill="#15213d" font-size="104" font-weight="700" letter-spacing="-3">Copy something.</text>
<text x="96" y="548" fill="#6552b8" font-size="104" font-weight="700" letter-spacing="-3">Do more with it.</text>
<text x="100" y="641" fill="#53617a" font-size="35">Keep useful clips ready for your next idea.</text>
</g>
<rect x="100" y="760" width="${appWidth}" height="${appHeight}" rx="${12*appWidth/width}" fill="#f3f6fc" filter="url(#shadow)"/>
<image x="100" y="760" width="${appWidth}" height="${appHeight}" preserveAspectRatio="xMidYMid meet" href="${toData(screenshot)}"/>
<g font-family="Segoe UI,sans-serif">
<text x="100" y="1608" fill="#15213d" font-size="43" font-weight="600">Find what you copied.</text>
<text x="100" y="1660" fill="#53617a" font-size="29">Search your history and filter by content type.</text>
<text x="100" y="1754" fill="#15213d" font-size="43" font-weight="600">See the useful details.</text>
<text x="100" y="1806" fill="#53617a" font-size="29">Preview notes and keep important clips starred or pinned.</text>
<text x="100" y="1900" fill="#15213d" font-size="43" font-weight="600">Make it your own.</text>
<text x="100" y="1952" fill="#53617a" font-size="29">Add previews and actions with optional extensions.</text>
<rect x="100" y="2040" width="54" height="4" rx="2" fill="url(#accent)"/>
<text x="100" y="2100" fill="#53617a" font-size="24">Free · Local clipboard history · Core features without an account</text>
</g>
</svg>`;
const posterName = 'poster-art-1440x2160';
await fs.writeFile(path.join(art, `${posterName}.svg`), poster);
await sharp(Buffer.from(poster)).png().toFile(path.join(art, `${posterName}.png`));
await fs.copyFile(path.join(art, `${posterName}.png`), path.join(upload, `${posterName}.png`));
for (const name of ['box-art-brand-blue-1080x1080','box-art-brand-blue-2160x2160',posterName]) {
  const metadata = await sharp(path.join(upload, `${name}.png`)).metadata();
  console.log(`${name}: ${metadata.width} × ${metadata.height} PNG`);
}
