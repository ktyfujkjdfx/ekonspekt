// E2E: настоящий Chromium + собранное расширение (dist/chrome); e.sfu-kras.ru подменяется фикстурами из test/fixtures.
// Проверяет кнопки, копирование, экспорт TXT/ZIP со снимками, Placement на 120 вопросов, view.php.
// Запуск: npx playwright install chromium && npm run e2e (тестовая сборка собирается сама)   (DARK=1 — тёмная тема)
// Стили темы Moodle берутся из .cache/moodle-css (локально, не в git); без них проверка работает, но снимки без оформления.
import { chromium } from 'playwright';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const PROJECT = resolve(import.meta.dirname, '..');
const OUT = join(PROJECT, 'dist', 'e2e');
// Тестовая сборка (--e2e): открытый Shadow DOM, чтобы автотест мог нажимать наши кнопки. В релизе он закрыт.
execFileSync(process.execPath, [join(PROJECT, 'scripts', 'build.mjs'), 'chrome', '--e2e'], { stdio: 'ignore' });
const EXT = join(PROJECT, 'dist', 'chrome-e2e');
const FILES = join(PROJECT, '.cache', 'moodle-css');
const FIX = join(PROJECT, 'test', 'fixtures');
mkdirSync(OUT, { recursive: true });
const dark = process.env.DARK === '1';

const STYLE = !existsSync(FILES)
  ? ''
  : '<link rel="stylesheet" href="/__files/css2"><link rel="stylesheet" href="/__files/combo(1)"><link rel="stylesheet" href="/__files/styles.php">';
const byAttempt = {
  6958707: 'review-cloze-audio.html',
  9693446: 'review-cloze-widget.html',
  7287449: 'review-cloze-tables.html',
  7599358: 'review-video-essay.html',
  9255881: 'review-placement-120.html',
  9258730: 'review-image.html',
  7236629: 'review-mixed-description.html',
};
const byLessonPage = {
  525642: 'lesson-content.html',
  525643: 'lesson-question-single.html',
  525646: 'lesson-content-image.html',
  '-9': 'lesson-end.html',
};
function page(file) {
  let h = readFileSync(join(FIX, file), 'utf8')
    .replace('</head>', STYLE + '</head>')
    .replace(/<div[^>]*modal-backdrop[^>]*><\/div>/g, '');
  if (dark) h = h.replace(/data-bs-theme=['"]light['"]/, 'data-bs-theme="dark"');
  return h;
}

const ctx = await chromium.launchPersistentContext(join(OUT, 'profile-' + Date.now()), {
  headless: true,
  channel: process.env.BROWSER || 'chromium',
  acceptDownloads: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://e.sfu-kras.ru' });
const requests = [];
await ctx.route(/^https?:\/\/(e\.sfu-kras\.ru|onlinetestpad\.com)\//, async (route) => {
  const u = new URL(route.request().url());
  requests.push(u.pathname + u.search);
  if (u.host !== 'e.sfu-kras.ru') return route.fulfill({ status: 404, body: '' });
  if (u.pathname.startsWith('/__files/')) {
    const name = decodeURIComponent(u.pathname.slice(9));
    const type = /styles\.php|css2|combo/.test(name) ? 'text/css' : 'application/octet-stream';
    try {
      return await route.fulfill({ body: readFileSync(join(FILES, name)), contentType: type });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  }
  if (u.pathname === '/mod/quiz/review.php') {
    const f = byAttempt[u.searchParams.get('attempt')];
    return f ? route.fulfill({ body: page(f), contentType: 'text/html; charset=utf-8' }) : route.fulfill({ status: 404, body: '' });
  }
  if (u.pathname === '/mod/lesson/view.php') {
    const f = byLessonPage[u.searchParams.get('pageid')];
    return f ? route.fulfill({ body: page(f), contentType: 'text/html; charset=utf-8' }) : route.fulfill({ status: 404, body: '' });
  }
  if (u.pathname === '/mod/quiz/view.php') return route.fulfill({ body: page('view-review-not-allowed.html'), contentType: 'text/html; charset=utf-8' });
  if (u.pathname.startsWith('/pluginfile.php/') && /\.(png|jpe?g|gif)/i.test(u.pathname)) {
    return route.fulfill({ body: readFileSync(join(PROJECT, 'icons', 'icon-128.png')), contentType: 'image/png' });
  }
  return route.fulfill({ status: 404, body: '' });
});

const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;
const log = (...a) => console.log('*', ...a);
const send = (urlPart, msg) =>
  sw.evaluate(
    async ([urlPart, msg]) => {
      const t = (await chrome.tabs.query({})).find((x) => x.url && x.url.includes(urlPart));
      return chrome.tabs.sendMessage(t.id, msg);
    },
    [urlPart, msg],
  );
await sw.evaluate(async () => {
  const r = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...r.settings, includeResults: true } });
});

async function openReview(attempt) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('  [console]', m.text().slice(0, 200));
  });
  await p.goto(`https://e.sfu-kras.ru/mod/quiz/review.php?attempt=${attempt}&cmid=1`);
  await p.waitForSelector('.que [data-ecx]', { timeout: 45000 });
  return p;
}

async function exportFrom(p, attempt, zip, name) {
  const dl = p.waitForEvent('download', { timeout: 120000 });
  const t0 = Date.now();
  const r = await send(`attempt=${attempt}`, { type: 'export', zip, includeResults: true });
  const d = await dl;
  const path = join(OUT, name + (zip ? '.zip' : '.txt'));
  await d.saveAs(path);
  log(name, JSON.stringify(r), `${Date.now() - t0} мс`, d.suggestedFilename());
  if (zip) {
    const z = unzipSync(readFileSync(path));
    for (const [n, data] of Object.entries(z)) writeFileSync(join(OUT, `${name}__${n.replace(/\//g, '_')}`), data);
    log('  zip:', Object.keys(z).join(', '));
  }
}

// Cloze с аудио: кнопка, копирование, скриншот страницы, ZIP.
let p = await openReview(6958707);
await p
  .locator('.que')
  .first()
  .screenshot({ path: join(OUT, `cloze-audio-page${dark ? '-dark' : ''}.png`), clip: undefined });
await p.locator('.que [data-ecx] button.copy').first().click();
await p.waitForTimeout(300);
writeFileSync(join(OUT, 'cloze-audio-clipboard.txt'), await p.evaluate(() => navigator.clipboard.readText()));
log('копирование Cloze:', (await p.evaluate(() => navigator.clipboard.readText())).split('\n').slice(0, 4).join(' / '));
await exportFrom(p, 6958707, false, 'cloze-audio');

// Видео + эссе + инфо-блоки с фото: ZIP со снимками (в т.ч. инфо-блоков).
p = await openReview(7599358);
log('кнопок (видео/эссе):', await p.locator('.que [data-ecx]').count(), 'вопросов:', await p.locator('.que').count());
await p
  .locator('.que')
  .nth(2)
  .screenshot({ path: join(OUT, `video-info-page${dark ? '-dark' : ''}.png`) });
await exportFrom(p, 7599358, true, 'video-essay');

// Вопрос с картинкой: кнопка «С картинкой» кладёт в буфер текст, HTML и PNG.
p = await openReview(9258730);
const imgBtn = p.locator('.que [data-ecx] >> button.copy.img').first();
log('кнопка «С картинкой»:', (await imgBtn.count()) ? 'есть' : 'НЕТ');
await imgBtn.click();
await p.waitForFunction(
  () => {
    const host = document.querySelector('.que ecx-panel[data-ecx]:not([data-notes])');
    const b = host?.shadowRoot?.querySelector('button.copy.img');
    return b && (b.classList.contains('done') || b.classList.contains('fail'));
  },
  null,
  { timeout: 20000 },
);
const clip = await p.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const out = {};
  for (const it of items)
    for (const t of it.types) {
      const b = await it.getType(t);
      out[t] = t.startsWith('text/') ? (await b.text()).slice(0, 80) : b.size;
      if (t === 'image/png') {
        const bytes = new Uint8Array(await b.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        out.png64 = btoa(bin);
      }
    }
  return out;
});
if (clip.png64) writeFileSync(join(OUT, 'clipboard-card.png'), Buffer.from(clip.png64, 'base64'));
delete clip.png64;
log('буфер «С картинкой»: форматы', Object.keys(clip).join(', '), '| PNG байт:', clip['image/png']);
await p
  .locator('.que [data-ecx]')
  .first()
  .screenshot({ path: join(OUT, `image-buttons${dark ? '-dark' : ''}.png`) });
// Вопрос с картинкой: ZIP.
await exportFrom(p, 9258730, true, 'image');

// Placement test на 120 вопросов: кнопки у всех и скорость.
const t0 = Date.now();
p = await openReview(9255881);
await p.waitForFunction(() => document.querySelectorAll('.que [data-ecx]').length === 120, null, { timeout: 20000 });
log('Placement: 120 кнопок за', Date.now() - t0, 'мс');
await exportFrom(p, 9255881, false, 'placement');

// Cloze с виджетом и таблицами.
p = await openReview(9693446);
await exportFrom(p, 9693446, false, 'cloze-widget');

// view.php: popup подсказывает про закрытый просмотр.
const vp = await ctx.newPage();
await vp.goto('https://e.sfu-kras.ru/mod/quiz/view.php?id=1');
await vp.waitForTimeout(500);
const viewTab = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url && t.url.includes('/quiz/view.php')).id);
log('view status:', JSON.stringify(await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'status' }), viewTab)));
const popup = await ctx.newPage();
await popup.addInitScript((id) => {
  const orig = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (q) => (q && q.active ? [await chrome.tabs.get(id)] : orig(q));
}, viewTab);
await popup.setViewportSize({ width: 360, height: 420 });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForTimeout(600);
await popup.screenshot({ path: join(OUT, 'popup-view.png') });

// popup на review с аудио.
const reviewTab = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url && t.url.includes('attempt=7599358')).id);
const popup2 = await ctx.newPage();
await popup2.addInitScript((id) => {
  const orig = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (q) => (q && q.active ? [await chrome.tabs.get(id)] : orig(q));
}, reviewTab);
await popup2.setViewportSize({ width: 360, height: 600 });
await popup2.goto(`chrome-extension://${extId}/popup.html`);
await popup2.waitForTimeout(800);
await popup2.screenshot({ path: join(OUT, 'popup-review.png'), fullPage: true });

// Лекция: страницы запоминаются по мере чтения, кнопки на странице, конспект TXT и ZIP с рисунками.
const LESSON = 'https://e.sfu-kras.ru/mod/lesson/view.php?id=1769636&pageid=';
const lp = await ctx.newPage();
lp.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
for (const id of ['525642', '525643', '525646']) {
  await lp.goto(LESSON + id);
  await lp.waitForSelector('[data-ecx-lesson]', { timeout: 45000 });
  if (id === '525643') {
    await lp.locator('[data-ecx-lesson] >> button.copy').first().click();
    await lp.waitForTimeout(300);
    log('лекция, копирование вопроса:', (await lp.evaluate(() => navigator.clipboard.readText())).split(String.fromCharCode(10)).slice(0, 4).join(' / '));
  }
  if (id === '525642') await lp.screenshot({ path: join(OUT, `lesson-page${dark ? '-dark' : ''}.png`), clip: { x: 0, y: 0, width: 1280, height: 520 } });
}
await lp.goto(LESSON + '-9');
await lp.waitForTimeout(800);
log('лекция, статус:', JSON.stringify((await send('pageid=-9', { type: 'status' })).lesson));
for (const zip of [false, true]) {
  const dl = lp.waitForEvent('download', { timeout: 60000 });
  const r = await send('pageid=-9', { type: 'export', zip, includeResults: false });
  const d = await dl;
  const path = join(OUT, 'lesson' + (zip ? '.zip' : '.txt'));
  await d.saveAs(path);
  log('лекция, выгрузка', JSON.stringify(r), d.suggestedFilename());
  if (zip) log('  zip:', Object.keys(unzipSync(readFileSync(path))).join(', '));
}
// «Собрать всю лекцию»: память лекции очищена, открыта одна страница — остальные расширение находит само.
await sw.evaluate(async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('lesson:')));
});
await lp.goto(LESSON + '525646');
await lp.waitForSelector('[data-ecx-lesson]', { timeout: 45000 });
const tc = Date.now();
log('лекция, собрать всю:', JSON.stringify(await send('pageid=525646', { type: 'collectLesson' })), `${Date.now() - tc} мс`);
const st = (await send('pageid=525646', { type: 'status' })).lesson;
log('лекция после сбора:', `страниц ${st.pages}, текст ${st.content}, вопросы ${st.questions}`);
log(
  'лекция, запросы:',
  requests
    .filter((r) => r.startsWith('/mod/lesson'))
    .slice(-30)
    .map((r) => r.split('pageid=')[1])
    .join(','),
);
log('лекция, POST/continue/финал в запросах сбора:', requests.slice(-30).some((r) => /continue\.php|pageid=-9/.test(r)) ? 'ЕСТЬ — ОШИБКА' : 'нет');

const lessonTab = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url && t.url.includes('pageid=525646')).id);
const popup3 = await ctx.newPage();
await popup3.addInitScript((id) => {
  const orig = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (q) => (q && q.active ? [await chrome.tabs.get(id)] : orig(q));
}, lessonTab);
await popup3.setViewportSize({ width: 376, height: 600 });
await popup3.goto(`chrome-extension://${extId}/popup.html`);
await popup3.waitForTimeout(900);
await popup3.screenshot({ path: join(OUT, `popup-lesson${dark ? '-dark' : ''}.png`), fullPage: true });
log('лекция, высота popup:', await popup3.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height)));

log(
  'внешние запросы:',
  requests
    .filter((r) => !r.startsWith('/__files') && !r.startsWith('/pluginfile') && !r.startsWith('/mod/quiz'))
    .slice(0, 10)
    .join(' | ') || 'нет',
);
await ctx.close();
