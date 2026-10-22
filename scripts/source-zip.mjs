// Архив исходников для ревью на Firefox AMO (код собран бандлером, AMO просит исходники + инструкцию сборки).
// Только белый список: в корне проекта лежат личные страницы и выгрузки (ФИО, sesskey) — они не должны
// попасть в архив, даже если появится новая папка, о которой здесь не знают.
import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { zipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const DIRS = ['src', 'test', 'icons', 'scripts', 'manifests', 'docs', '.github'];
const FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'eslint.config.js',
  '.prettierrc.json',
  '.prettierignore',
  '.gitignore',
  '.gitattributes',
  '.nvmrc',
  'README.md',
  'CHANGELOG.md',
  'INSTALL.md',
  'PRIVACY.md',
  'PUBLISHING.md',
  'ROADMAP.md',
  'STORE.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'LICENSE',
];
const files = {};

// Два фильтра сразу: белый список папок и .gitignore (локальные файлы вроде personal-markers.local.txt не попадут).
let tracked = null;
try {
  tracked = new Set(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean),
  );
} catch {
  console.warn('git недоступен — архив собирается только по белому списку');
}
const wanted = (rel) => !tracked || tracked.has(rel);

async function add(dir) {
  for (const name of await readdir(dir)) {
    if (name.endsWith('.mhtml') || name === '1828755.png' || name.startsWith('_tmp') || name.includes('.local.')) continue;
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) await add(p);
    else {
      const rel = relative(root, p).split(sep).join('/');
      if (wanted(rel)) files[rel] = new Uint8Array(await readFile(p));
    }
  }
}
for (const d of DIRS) if (existsSync(join(root, d))) await add(join(root, d));
for (const f of FILES) if (existsSync(join(root, f)) && wanted(f)) files[f] = new Uint8Array(await readFile(join(root, f)));

// Последняя проверка: в фикстурах не должно остаться ключа сессии.
for (const [name, data] of Object.entries(files)) {
  if (!name.startsWith('test/fixtures/')) continue;
  const text = new TextDecoder().decode(data);
  const key = text.match(/sesskey(?:=|":"|" value=")(?!X{10})([A-Za-z0-9]{10})/);
  if (key) {
    console.error(`В ${name} остался sesskey — обезличьте фикстуру.`);
    process.exit(2);
  }
}

files['BUILD-AMO.txt'] = new TextEncoder().encode(
  [
    `eKonspekt ${pkg.version} — build from source / сборка из исходников`,
    '',
    'Requirements / Требования: Node.js 24 (see .nvmrc), npm 11+. Any OS (built and verified on Windows 11; CI builds on Ubuntu).',
    '',
    '  npm ci',
    '  npm run build:firefox',
    '',
    'Output / Результат: dist/firefox/ — identical to the uploaded add-on (manifest, JS, HTML, CSS, icons, fonts, _locales).',
    'Bundler: esbuild (scripts/build.mjs), IIFE bundles, NOT minified (identifiers kept), no source maps, no remote code.',
    'One build-time patch: html-to-image clone-node.js — "clonedNode.innerHTML = nativeNode.value" → textContent (see hardenHtmlToImage).',
    'Third-party code bundled from npm: html-to-image 1.11.13 (MIT, question snapshots), fflate 0.8.3 (MIT, ZIP).',
    'Fonts: @fontsource-variable/geologica and /oswald (SIL OFL 1.1), copied as files.',
    'Licenses of bundled libraries: THIRD_PARTY_NOTICES.txt in the built add-on.',
    '',
  ].join('\n'),
);

await mkdir(join(root, 'release'), { recursive: true });
const out = join(root, 'release', `ekonspekt-source-${pkg.version}.zip`);
await writeFile(out, zipSync(files, { level: 9 }));
console.log(`${relative(root, out)}: ${Object.keys(files).length} файлов`);
