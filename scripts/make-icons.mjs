// Иконки из знака «Книга» (icons/src/book.svg; для 16 px — book-16.svg на пиксельной сетке).
//   icons/app/icon-N.png   — иконка расширения (страница расширений, магазины): тёмная плитка со светящейся книгой
//   icons/ink/icon-N.png   — знак на панели для светлой темы браузера (глубокий бирюзово-синий), он же icons/icon-N.png
//   icons/sand/icon-N.png  — знак на панели для тёмной темы браузера (яркий, светящийся)
//   icons/glyph.svg        — знак для кнопок и окна (CSS-маска: цвет задаёт тема)
//   icons/mark.svg         — мастер-файл знака (монохром, currentColor)
// Растеризация — в Chromium (Playwright). Запуск: node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'icons', 'src');
const SIZES = [16, 32, 48, 128];

/** Части знака: страницы, строки, галочка — каждой свой цвет. */
function parts(file) {
  const src = readFileSync(join(SRC, file), 'utf8');
  return [...src.matchAll(/<path data-part="(\w+)" d="([^"]+)"\/>/g)].map((m) => ({ part: m[1], d: m[2] }));
}

/** Знак на прозрачном фоне в градиенте — для панели браузера. */
function glyphSvg(size, pal) {
  const small = size <= 16;
  const box = small ? 16 : 24;
  const sw = small ? 1.45 : 1.8;
  const ps = parts(small ? 'book-16.svg' : 'book.svg');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="${box}" y2="${box}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${pal.a}"/><stop offset="1" stop-color="${pal.b}"/></linearGradient></defs>
  <g fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
    ${ps.map(({ part, d }) => `<path d="${d}" stroke="${part === 'check' ? pal.check : 'url(#g)'}"/>`).join('')}
  </g>
</svg>`;
}

/**
 * Плитка для страницы расширений и магазинов. Приёмы «дорогих» иконок:
 * глубокий тёмный фон с объёмом, мягкое свечение за знаком, светящийся градиент знака,
 * тонкий блик-рамка сверху.
 */
function tileSvg(size) {
  const small = size <= 16;
  // 128 px: небольшое поле (Chrome показывает на странице расширений уменьшенную 128-ю — с полем 16 px плитка мелкая).
  const pad = size === 128 ? 6 : size >= 48 ? 2 : size >= 32 ? 1 : 0;
  const w = size - pad * 2;
  const r = w * 0.25;
  const box = small ? 16 : 24;
  const art = w * (small ? 0.9 : 0.68);
  const k = art / box;
  const off = pad + (w - art) / 2;
  const sw = small ? 1.5 : size <= 32 ? 1.9 : 1.75;
  const ps = parts(small ? 'book-16.svg' : 'book.svg');
  const pages = ps.filter((p) => p.part === 'page');
  // Тело книги — лёгкая заливка страниц (две внешние кривые, без корешка).
  const fill = pages
    .slice(0, 2)
    .map((p) => `<path d="${p.d}Z" fill="url(#pf)" stroke="none"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="30%" cy="18%" r="95%"><stop offset="0" stop-color="#1f3358"/><stop offset=".55" stop-color="#121d36"/><stop offset="1" stop-color="#0a1122"/></radialGradient>
    <radialGradient id="glow" cx="50%" cy="54%" r="46%"><stop offset="0" stop-color="#3fe0c0" stop-opacity=".30"/><stop offset=".55" stop-color="#4f86ff" stop-opacity=".14"/><stop offset="1" stop-color="#4f86ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".30"/><stop offset=".35" stop-color="#ffffff" stop-opacity=".06"/><stop offset="1" stop-color="#ffffff" stop-opacity=".03"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".09"/><stop offset=".45" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="${box}" y2="${box}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7cf5d6"/><stop offset=".5" stop-color="#5fd0f2"/><stop offset="1" stop-color="#7ea6ff"/></linearGradient>
    <linearGradient id="pf" x1="0" y1="0" x2="0" y2="${box}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7cf5d6" stop-opacity=".16"/><stop offset="1" stop-color="#7ea6ff" stop-opacity=".05"/></linearGradient>
  </defs>
  <rect x="${pad}" y="${pad}" width="${w}" height="${w}" rx="${r}" fill="url(#bg)"/>
  <rect x="${pad}" y="${pad}" width="${w}" height="${w}" rx="${r}" fill="url(#glow)"/>
  <rect x="${pad}" y="${pad}" width="${w}" height="${w}" rx="${r}" fill="url(#sheen)"/>
  <rect x="${pad + 0.5}" y="${pad + 0.5}" width="${w - 1}" height="${w - 1}" rx="${r - 0.5}" fill="none" stroke="url(#rim)"/>
  <g transform="translate(${off} ${off}) scale(${k})">
    ${fill}
    <g fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      ${ps.map(({ part, d }) => `<path d="${d}" stroke="${part === 'check' ? '#9bfbe2' : part === 'line' ? '#a9c6ff' : 'url(#ink)'}"/>`).join('')}
    </g>
  </g>
</svg>`;
}

// Знак на панели: для светлой темы — глубже и темнее (контраст на белом), для тёмной — ярче.
const PANEL = {
  ink: { a: '#0b8f7c', b: '#2856d8', check: '#0a9f78' },
  sand: { a: '#74f2d1', b: '#86adff', check: '#9bfbe2' },
};

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
const render = (svg, size) =>
  page.evaluate(
    async ([src, size]) => {
      const img = new Image(size, size);
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      c.getContext('2d').drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png').split(',')[1];
    },
    ['data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), size],
  );

for (const [name, pal] of Object.entries(PANEL)) {
  mkdirSync(join(ROOT, 'icons', name), { recursive: true });
  for (const s of SIZES) {
    const png = Buffer.from(await render(glyphSvg(s, pal), s), 'base64');
    writeFileSync(join(ROOT, 'icons', name, `icon-${s}.png`), png);
    if (name === 'ink') writeFileSync(join(ROOT, 'icons', `icon-${s}.png`), png);
  }
}
mkdirSync(join(ROOT, 'icons', 'app'), { recursive: true });
for (const s of SIZES) writeFileSync(join(ROOT, 'icons', 'app', `icon-${s}.png`), Buffer.from(await render(tileSvg(s), s), 'base64'));
writeFileSync(join(SRC, 'app-icon.svg'), tileSvg(128));

const clean = readFileSync(join(SRC, 'book.svg'), 'utf8')
  .replace(/\s*<!--[\s\S]*?-->/g, '')
  .replace(/ data-part="\w+"/g, '');
writeFileSync(join(ROOT, 'icons', 'mark.svg'), clean);
// Для маски нужен непрозрачный штрих — красим в чёрный (словом: «#» ломает data:-URL).
writeFileSync(join(ROOT, 'icons', 'glyph.svg'), clean.replace(/currentColor/g, 'black'));
await browser.close();
console.log('icons ok');
