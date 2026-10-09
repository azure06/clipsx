import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// Rendering dependency supplied by the Codex workspace runtime.
const require = createRequire('C:/Users/gabri/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json');
const sharp = require('sharp');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = path.resolve(here, '../..');
const output = path.join(here, 'v2');
await fs.mkdir(output, { recursive: true });
const upload = path.join(here, 'upload');
await fs.mkdir(upload, { recursive: true });
const data = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const identitySource = await fs.readFile(path.resolve(root, '../clipsx-web/src/components/brand/IconLab.tsx'), 'utf8');
const pathTop = identitySource.match(/const pathTop = "([^"]+)"/)[1];
const pathBottom = identitySource.match(/const pathBottom = "([^"]+)"/)[1];
function identityMark(dark) {
  // Exact shape and palette from identity-studio's Pearl/Ink candidates.
  const top = dark ? ['#f3f4f6', '#aab4c4'] : ['#334155', '#172033'];
  const bottom = dark ? ['#d9e0ea', '#929eaf'] : ['#475569', '#182238'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="300 320 1320 1240"><defs><linearGradient id="top" gradientUnits="userSpaceOnUse" x1="324" y1="940" x2="1592" y2="940"><stop stop-color="${top[0]}"/><stop offset="1" stop-color="${top[1]}"/></linearGradient><linearGradient id="bottom" gradientUnits="userSpaceOnUse" x1="324" y1="940" x2="1592" y2="940"><stop stop-color="${bottom[0]}"/><stop offset="1" stop-color="${bottom[1]}"/></linearGradient></defs><path fill="url(#top)" d="${pathTop}"/><path fill="url(#bottom)" d="${pathBottom}"/></svg>`;
}

const assets = [
  { name: '01-light-main', source: 'light-markdown', theme: 'light', eyebrow: 'FIND YOUR FOCUS', title: 'A clearer view of your notes.', subtitle: 'Filter your history by Markdown and preview the content you need.', footer: 'Filter by content type · Preview Markdown · Copy it again', number: '01', glow: '#5abfdd' },
  { name: '02-light-extensions', source: 'light-extensions', theme: 'light', eyebrow: 'MORE POSSIBILITIES FOR EVERY CLIP', title: 'More ways to work with clips.', subtitle: 'Explore extensions for diagrams, data, rewriting, and more.', footer: 'Discover packages · Configure your tools · Keep your workflow together', number: '02', glow: '#5abfdd' },
  { name: '03-light-intelligence', source: 'light-intelligence', theme: 'light', eyebrow: 'A CLEARER VIEW OF LOCAL AI', title: 'Your models. Your machine.', subtitle: 'Connect Ollama and choose the models that fit your workflow.', footer: 'Optional AI features require Ollama and separately installed models', number: '03', glow: '#9a83ec' },
  { name: '04-dark-main', source: 'dark-markdown', theme: 'dark', eyebrow: 'KEEP THE USEFUL DETAILS', title: 'Your notes, beautifully readable.', subtitle: 'Preview Markdown and keep important clips starred and pinned.', footer: 'Readable previews · Favorites · Pinned clips', number: '04', glow: '#6434dc' },
  { name: '05-dark-extensions', source: 'dark-extensions', theme: 'dark', eyebrow: 'MAKE CLIPSX YOUR OWN', title: 'Extend your clipboard.', subtitle: 'Add previews, transformations, and actions with extensions.', footer: 'Discover packages · Configure your tools · Keep your workflow together', number: '05', glow: '#6434dc' },
  { name: '06-dark-intelligence', source: 'dark-intelligence', theme: 'dark', eyebrow: 'INTELLIGENCE ON YOUR TERMS', title: 'Choose your local intelligence.', subtitle: 'Configure local search and generation with Ollama.', footer: 'Optional AI features require Ollama and separately installed models', number: '06', glow: '#0069b8' },
];

for (const item of assets) {
  const dark = item.theme === 'dark';
  const source = path.join(output, `inputs/${item.source}.png`);
  const logo = await sharp(Buffer.from(identityMark(dark))).png().toBuffer();
  const original = await fs.readFile(source);
  const { width, height } = await sharp(original).metadata();
  // The screenshot's 12 px app corners contain desktop pixels. Mask only
  // those corner regions; preserve every interior screenshot pixel.
  const mask = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="12" fill="white"/></svg>`);
  const cutout = await sharp(original).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  await fs.writeFile(path.join(output, `source-${item.source}-rounded.png`), cutout);
  const appW = 1320;
  const appH = appW * height / width;
  const appX = (1920 - appW) / 2;
  const appY = 245;
  const fg = dark ? '#f5f7ff' : '#15213d';
  const secondary = dark ? '#b9c3d7' : '#53617a';
  const bg = dark ? '#080f21' : '#f5f8fe';
  const accent = dark ? '#b1a0ff' : '#6552b8';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs>
  <radialGradient id="glow"><stop stop-color="${item.glow}" stop-opacity="${dark ? '.55' : '.24'}"/><stop offset="1" stop-color="${item.glow}" stop-opacity="0"/></radialGradient>
  <radialGradient id="blue"><stop stop-color="${dark ? '#0579bd' : '#b6ddf5'}" stop-opacity="${dark ? '.25' : '.65'}"/><stop offset="1" stop-color="${bg}" stop-opacity="0"/></radialGradient>
  <linearGradient id="line"><stop stop-color="#2398ed"/><stop offset="1" stop-color="#a08dff"/></linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="${dark ? '#010511' : '#344c76'}" flood-opacity="${dark ? '.65' : '.20'}"/></filter>
</defs>
<rect width="1920" height="1080" fill="${bg}"/>
<ellipse cx="${item.number === '02' || item.number === '04' ? 350 : 1530}" cy="850" rx="950" ry="780" fill="url(#glow)"/>
<ellipse cx="190" cy="720" rx="950" ry="800" fill="url(#blue)"/>
<path d="M-80 1030 Q450 590 1040 880 T2040 510" fill="none" stroke="${dark ? '#677ab5' : '#91a6cb'}" stroke-opacity=".13" stroke-width="2"/>
<path d="M-80 1060 Q450 620 1040 910 T2040 540" fill="none" stroke="${dark ? '#677ab5' : '#91a6cb'}" stroke-opacity=".08" stroke-width="2"/>
<g font-family="Segoe UI, sans-serif">
<rect x="86" y="49" width="42" height="4" rx="2" fill="url(#line)"/>
<text x="146" y="58" fill="${accent}" font-size="18" font-weight="600" letter-spacing="3">${escape(item.eyebrow)}</text>
<text x="86" y="142" fill="${fg}" font-size="68" font-weight="700" letter-spacing="-2">${escape(item.title)}</text>
<text x="88" y="193" fill="${secondary}" font-size="27">${escape(item.subtitle)}</text>
<image x="1703" y="44" width="48" height="48" href="${data(logo)}"/>
<text x="1763" y="78" fill="${fg}" font-size="32" font-weight="700">ClipsX</text>
</g>
<rect x="${appX}" y="${appY}" width="${appW}" height="${appH}" rx="${12 * appW / width}" fill="${dark ? '#172034' : '#f3f6fc'}" filter="url(#shadow)"/>
<image x="${appX}" y="${appY}" width="${appW}" height="${appH}" preserveAspectRatio="xMidYMid meet" href="${data(cutout)}"/>
<g font-family="Segoe UI, sans-serif" font-size="18" fill="${secondary}">
<text x="86" y="1050" letter-spacing="1">${escape(item.footer)}</text>
<text x="1833" y="1050" text-anchor="end" fill="${accent}" letter-spacing="2">${item.number} / ${String(assets.length).padStart(2, '0')}</text>
</g>
</svg>`;
  await fs.writeFile(path.join(output, `${item.name}.svg`), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(output, `${item.name}.png`));
  await fs.copyFile(path.join(output, `${item.name}.png`), path.join(upload, `${item.name}.png`));
}

const thumbs = await Promise.all(assets.map((a) => sharp(path.join(output, `${a.name}.png`)).resize(960, 540).png().toBuffer()));
await sharp({ create: { width: 1920, height: Math.ceil(assets.length / 2) * 540, channels: 3, background: '#d8e0ed' } })
  .composite(thumbs.map((input, i) => ({ input, left: (i % 2) * 960, top: Math.floor(i / 2) * 540 })))
  .png().toFile(path.join(output, 'contact-sheet.png'));
console.log(`Created ${assets.length} separate 1920 × 1080 PNGs, editable SVGs, rounded source cutouts, and a contact sheet.`);
