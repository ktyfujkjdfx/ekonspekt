// Сборка: node scripts/build.mjs <chrome|firefox> [--zip] [--watch]
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { zipSync } from 'fflate';

const target = process.argv[2];
if (!['chrome', 'firefox'].includes(target)) {
  console.error('Использование: node scripts/build.mjs <chrome|firefox> [--zip] [--watch]');
  process.exit(1);
}
const watch = process.argv.includes('--watch');
const makeZip = process.argv.includes('--zip');
const e2e = process.argv.includes('--e2e'); // тестовая сборка с крючком для автотестов, не для магазинов
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist', e2e ? `${target}-e2e` : target);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

// Архив для магазина без почты поддержки — форма «Поддержка» не будет отправлять сообщения.
if (makeZip) {
  const support = await readFile(join(root, 'src/shared/support.ts'), 'utf8');
  if (!/SUPPORT_EMAIL = '[^'\s]+@[^'\s]+'/.test(support)) {
    console.warn('\n⚠ Почта поддержки не указана: впишите адрес в SUPPORT_EMAIL (src/shared/support.ts), иначе «Поддержка» не отправит сообщение.\n');
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// manifest = base + переопределения браузера
const base = JSON.parse(await readFile(join(root, 'manifests/base.json'), 'utf8'));
const extra = JSON.parse(await readFile(join(root, `manifests/${target}.json`), 'utf8'));
const manifest = { ...base, ...extra, version: pkg.version };
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

await cp(join(root, 'src/popup/popup.html'), join(out, 'popup.html'));
await cp(join(root, 'src/popup/popup.css'), join(out, 'popup.css'));
// Название и описание на языке браузера (ru по умолчанию, en для англоязычных магазинов).
await cp(join(root, 'src/_locales'), join(out, '_locales'), { recursive: true });
// Иконки (без исходника 512px) и локальные шрифты popup (OFL).
await cp(join(root, 'icons'), join(out, 'icons'), { recursive: true, filter: (p) => !p.endsWith('1828755.png') && !p.includes(`icons${sep}src`) });
await mkdir(join(out, 'fonts'), { recursive: true });
for (const [pkg, files] of Object.entries({
  geologica: ['geologica-cyrillic-wght-normal.woff2', 'geologica-latin-wght-normal.woff2'],
  oswald: ['oswald-cyrillic-wght-normal.woff2', 'oswald-latin-wght-normal.woff2'],
})) {
  const dir = join(root, 'node_modules', '@fontsource-variable', pkg);
  for (const f of files) await cp(join(dir, 'files', f), join(out, 'fonts', f));
  await cp(join(dir, 'LICENSE'), join(out, 'fonts', `${pkg}-OFL.txt`));
}

/**
 * Защита в глубину: html-to-image копирует текст <textarea> через innerHTML. Внутри textarea разметка не
 * разбирается (это обычный текст), но строку помечает проверка AMO, а textContent делает то же самое без риска.
 * Если после обновления библиотеки строка изменится — сборка упадёт, чтобы замена не пропала молча.
 */
const hardenHtmlToImage = {
  name: 'harden-html-to-image',
  setup(b) {
    b.onLoad({ filter: /html-to-image[\\/](es|lib)[\\/]clone-node\.js$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      const unsafe = 'clonedNode.innerHTML = nativeNode.value';
      if (!src.includes(unsafe))
        throw new Error('html-to-image: не найдена строка для безопасной замены — проверьте clone-node.js после обновления библиотеки');
      return { contents: src.replace(unsafe, 'clonedNode.textContent = nativeNode.value'), loader: 'js' };
    });
  },
};

const options = {
  plugins: [hardenHtmlToImage],
  entryPoints: {
    content: join(root, 'src/content/index.ts'),
    popup: join(root, 'src/popup/popup.ts'),
    background: join(root, 'src/background/index.ts'),
  },
  outdir: out,
  bundle: true,
  format: 'iife',
  target: target === 'firefox' ? ['firefox140'] : ['chrome111'],
  define: { __BROWSER__: JSON.stringify(target), __E2E__: JSON.stringify(e2e) },
  loader: { '.png': 'dataurl', '.svg': 'base64' },
  sourcemap: watch ? 'inline' : false,
  minify: false, // магазины расширений лучше проверяют читаемый код
  minifySyntax: true, // но константы сворачиваем: тестовый код (__E2E__) не попадает в сборку
  legalComments: 'none', // лицензии библиотек кладём отдельным файлом THIRD_PARTY_NOTICES.txt (см. ниже)
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`Слежу за изменениями → dist/${target}`);
} else {
  await build(options);
  // MIT требует прикладывать текст лицензии к копиям библиотек: fflate (ZIP) и html-to-image (снимки вопросов).
  const notices = ['Сторонние библиотеки, встроенные в расширение / Third-party libraries bundled into this extension', ''];
  for (const lib of ['fflate', 'html-to-image']) {
    const dir = join(root, 'node_modules', lib);
    const meta = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const lic = (await readdir(dir)).find((f) => /^licen[sc]e/i.test(f));
    notices.push(`== ${lib} ${meta.version} (${meta.license}) ==`, lic ? (await readFile(join(dir, lic), 'utf8')).trim() : meta.license, '');
  }
  notices.push('== Шрифты Geologica и Oswald == SIL Open Font License 1.1 — тексты лицензий в папке fonts/.');
  await writeFile(join(out, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
  if (makeZip) {
    const files = {};
    async function add(dir) {
      for (const name of await readdir(dir)) {
        const p = join(dir, name);
        if ((await stat(p)).isDirectory()) await add(p);
        else files[relative(out, p).split(sep).join('/')] = new Uint8Array(await readFile(p));
      }
    }
    await add(out);
    await mkdir(join(root, 'release'), { recursive: true });
    const zipName = `ekonspekt-${target}-${pkg.version}.zip`;
    await writeFile(join(root, 'release', zipName), zipSync(files, { level: 9 }));
    console.log(`release/${zipName}`);
  }
}
