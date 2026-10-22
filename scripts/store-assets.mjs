// Материалы для магазинов: скриншоты 1280×800, промо-плитка 440×280, баннер 1400×560.
// Снимается настоящее расширение (dist/chrome) в Chromium на демо-вопросах (без чужих данных и реальных курсов).
// Запуск: npm run store-assets  → store/ (тестовая сборка собирается сама)
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
// Тестовая сборка (--e2e): открытый Shadow DOM, чтобы нажать «Копировать» для снимка. Внешне она совпадает с релизом.
execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), 'chrome', '--e2e'], { stdio: 'ignore' });
const EXT = join(ROOT, 'dist', 'chrome-e2e');
const OUT = join(ROOT, 'store');
const FILES = join(ROOT, '.cache', 'moodle-css');
mkdirSync(join(OUT, 'raw'), { recursive: true });

const font = (pkg, file) => `data:font/woff2;base64,${readFileSync(join(ROOT, 'node_modules', '@fontsource-variable', pkg, 'files', file)).toString('base64')}`;
const FONTS = `
@font-face{font-family:'Oswald';font-weight:200 700;src:url(${font('oswald', 'oswald-cyrillic-wght-normal.woff2')}) format('woff2');unicode-range:U+0400-045F}
@font-face{font-family:'Oswald';font-weight:200 700;src:url(${font('oswald', 'oswald-latin-wght-normal.woff2')}) format('woff2');unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:'Geologica';font-weight:100 900;src:url(${font('geologica', 'geologica-cyrillic-wght-normal.woff2')}) format('woff2');unicode-range:U+0400-045F}
@font-face{font-family:'Geologica';font-weight:100 900;src:url(${font('geologica', 'geologica-latin-wght-normal.woff2')}) format('woff2');unicode-range:U+0000-00FF,U+2000-206F}`;
const GLYPH = `data:image/svg+xml;base64,${readFileSync(join(ROOT, 'icons', 'glyph.svg')).toString('base64')}`;

// ─── Демо-страница теста в разметке Moodle 5 / Moove ───
const diagram =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="170" viewBox="0 0 420 170"><rect width="420" height="170" fill="#fff"/><g font-family="Arial" font-size="14" fill="#222"><rect x="20" y="20" width="160" height="120" fill="#f4f6f8" stroke="#555"/><line x1="20" y1="48" x2="180" y2="48" stroke="#555"/><text x="62" y="39">Account</text><text x="30" y="72">- balance: double</text><text x="30" y="96">+ deposit(sum)</text><text x="30" y="120">+ getBalance()</text><rect x="250" y="40" width="150" height="80" fill="#f4f6f8" stroke="#555"/><text x="285" y="85">Client</text><line x1="180" y1="80" x2="250" y2="80" stroke="#555" marker-end="url(#a)"/></g><defs><marker id="a" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10" fill="none" stroke="#555"/></marker></defs></svg>`,
  ).toString('base64');
const info = (n, state, grade) =>
  `<div class="info"><div class="d-flex align-items-center flex-wrap mb-sm-2 mb-md-0"><h4 class="h3 w-100 mb-2">Вопрос <span class="rui-qno">${n}</span></h4><div class="d-inline-flex align-items-center flex-wrap"><div class="state mr-2 my-2">${state}</div><div class="grade">${grade}</div></div></div><div><div class="questionflag mb-sm-2 mb-md-0 mx-md-2 editable d-inline-flex"><a class="aabtn">Отметить вопрос</a></div></div></div>`;
const choice = (i, letter, text, checked) =>
  `<div class="r${i % 2}"><input type="radio" name="q1" value="${i}" id="c${i}" aria-labelledby="c${i}_label"${checked ? ' checked' : ''}><div class="d-flex w-auto" id="c${i}_label" data-region="answer-label"><span class="answernumber">${letter}. </span><div class="flex-fill ms-1"><p>${text}</p></div></div></div>`;
const select = (opts) =>
  `<span class="subquestion"><select class="select form-select"><option value="">&nbsp;</option>${opts.map((o, i) => `<option value="${i}">${o}</option>`).join('')}</select></span>`;
const textgap = () => '<span class="subquestion"><input type="text" size="12" class="form-control d-inline mb-1"></span>';
const DEMO = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Итоговый тест (страница 1 из 3)</title>
${existsSync(FILES) ? '<link rel="stylesheet" href="/__files/css2"><link rel="stylesheet" href="/__files/combo(1)"><link rel="stylesheet" href="/__files/styles.php">' : ''}
<style>body{background:#fff} #page{max-width:880px;margin:24px auto;padding:0 24px}</style></head>
<body id="page-mod-quiz-attempt" class="path-mod-quiz cmid-1" data-bs-theme="light"><div id="page"><div role="main">
<ol class="breadcrumb" hidden><li class="breadcrumb-item"><a href="/course/view.php?id=1" title="Основы программирования и права">Основы программирования и права</a></li></ol>
<div class="page-header-headings" hidden><h1>Итоговый тест</h1></div>
<form id="responseform"><div>
<div id="question-1-1" class="que multichoice deferredfeedback answersaved">${info(1, 'Ответ сохранен', 'Балл: 1,00')}<div class="content"><div class="formulation clearfix"><div class="qtext"><p>Какой принцип ООП показан на схеме: поле <code>balance</code> закрыто, работа с ним — только через методы?</p><p><img src="${diagram}" width="420" height="170" alt="UML"></p></div>
<fieldset class="ablock"><legend class="prompt h6 fw-normal visually-hidden">Выберите один ответ:</legend><div class="answer">${choice(0, 'a', 'Наследование')}${choice(1, 'b', 'Инкапсуляция', true)}${choice(2, 'c', 'Полиморфизм')}${choice(3, 'd', 'Абстракция')}</div></fieldset></div></div></div>
<div id="question-1-2" class="que multianswer deferredfeedback notyetanswered">${info(2, 'Пока нет ответа', 'Балл: 2,00')}<div class="content"><div class="formulation clearfix"><h4 class="accesshide">Текст вопроса</h4><p>Договор купли-продажи недвижимости заключается в ${select(['устной', 'письменной', 'любой'])} форме путём составления одного документа, подписанного ${select(['сторонами', 'нотариусом', 'продавцом'])}.</p></div></div></div>
<div id="question-1-3" class="que multianswer deferredfeedback notyetanswered">${info(3, 'Пока нет ответа', 'Балл: 2,00')}<div class="content"><div class="formulation clearfix"><h4 class="accesshide">Текст вопроса</h4><p>Listen and fill in the gaps.</p><div class="mediaplugin mediaplugin_videojs d-block"><div style="max-width:400px;"><audio class="video-js" controls="true" title="meeting.mp3"><source src="/pluginfile.php/1/question/questiontext/meeting.mp3" type="audio/mp3"></audio></div></div><p>The meeting was ${textgap()} until Friday because the manager was ${textgap()}.</p></div></div></div>
</div></form>
<section id="mod_quiz_navblock"><div class="qn_buttons clearfix multipages">
${[1, 2, 3, 4, 5, 6].map((n) => `<a class="qnbutton free btn${n <= 3 ? ' thispage' : ''}" data-quiz-page="${Math.floor((n - 1) / 3)}" href="/mod/quiz/attempt.php?attempt=1&amp;cmid=1&amp;page=${Math.floor((n - 1) / 3)}"><span class="accesshide">Вопрос </span>${n}</a>`).join('')}
</div></section></div></div></body></html>`;

// ─── 1. «Сырые» снимки настоящего расширения ───
async function captureRaw(scheme) {
  const ctx = await chromium.launchPersistentContext('', {
    headless: true,
    channel: 'chromium',
    colorScheme: scheme,
    viewport: { width: 980, height: 1200 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://e.sfu-kras.ru' });
  await ctx.route(/^https?:\/\/(e\.sfu-kras\.ru)\//, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/__files/')) {
      try {
        return await route.fulfill({ body: readFileSync(join(FILES, decodeURIComponent(u.pathname.slice(9)))), contentType: 'text/css' });
      } catch {
        return route.fulfill({ status: 404, body: '' });
      }
    }
    if (u.pathname === '/mod/quiz/attempt.php') {
      return route.fulfill({
        body:
          scheme === 'dark' ? DEMO.replace('data-bs-theme="light"', 'data-bs-theme="dark"').replace('body{background:#fff}', 'body{background:#22262b}') : DEMO,
        contentType: 'text/html; charset=utf-8',
      });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto('https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=1&cmid=1');
  await page.waitForSelector('.que [data-ecx]');
  await page.waitForTimeout(500);
  await page.locator('#question-1-1').hover();
  await page.waitForTimeout(400);
  await page.locator('#question-1-1').screenshot({ path: join(OUT, 'raw', `${scheme}-q1.png`) });
  await page.locator('#question-1-1 [data-ecx] button.copy:not(.img)').click();
  await page.waitForTimeout(700);
  await page.locator('#question-1-1 .info').screenshot({ path: join(OUT, 'raw', `${scheme}-q1-copied.png`) });
  await page.locator('#question-1-3').hover();
  await page.waitForTimeout(400);
  await page.locator('#question-1-3').screenshot({ path: join(OUT, 'raw', `${scheme}-q3.png`) });
  const clip = await page.evaluate(() => navigator.clipboard.readText());

  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url && t.url.includes('attempt.php')).id);
  const popup = await ctx.newPage();
  await popup.addInitScript((id) => {
    const orig = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (q) => (q && q.active ? [await chrome.tabs.get(id)] : orig(q));
  }, tabId);
  await popup.setViewportSize({ width: 368, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForTimeout(1600);
  const h = await popup.evaluate(() => document.documentElement.scrollHeight);
  await popup.screenshot({ path: join(OUT, 'raw', `${scheme}-popup.png`), clip: { x: 0, y: 0, width: 368, height: h } });
  await ctx.close();
  return clip;
}

const clip = await captureRaw('light');
await captureRaw('dark');
const raw = (n) => `data:image/png;base64,${readFileSync(join(OUT, 'raw', n)).toString('base64')}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ─── 2. Композиции ───
const BASE = `${FONTS}
*{box-sizing:border-box;margin:0}
body{width:var(--w);height:var(--h);overflow:hidden;font-family:'Geologica',sans-serif;color:#241f1a;
  background:radial-gradient(900px 600px at 90% -10%,rgba(178,196,240,.55),transparent 60%),radial-gradient(700px 500px at -5% 110%,rgba(248,214,196,.45),transparent 60%),linear-gradient(160deg,#f6f8fb,#eef1f7)}
body.dark{color:#e9edf4;background:radial-gradient(900px 600px at 90% -10%,rgba(120,146,214,.22),transparent 60%),linear-gradient(160deg,#22262c,#181a1f)}
.brand{display:flex;align-items:center;gap:12px;font:600 22px/1 'Geologica';letter-spacing:-.02em;color:#1d2a40}
.dark .brand{color:#e9edf4}
.glyph{width:26px;height:26px;background:currentColor;-webkit-mask:url(${GLYPH}) center/contain no-repeat}
h1{font:600 56px/1.04 'Geologica';letter-spacing:-.03em}
p.lead{font-size:20px;line-height:1.5;color:#5d687a;margin-top:22px}
.dark p.lead{color:#97a1b0}
.shot{border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 1px 0 rgba(255,255,255,.8) inset,0 2px 6px rgba(60,44,26,.08),0 40px 80px -30px rgba(60,44,26,.45);border:1px solid rgba(74,58,40,.12)}
.dark .shot{background:#1f1c18;border-color:rgba(240,222,196,.1);box-shadow:0 40px 80px -30px rgba(0,0,0,.9)}
.shot img{display:block;width:100%}
.shot.pad{padding:22px 24px;background:#fff}
.dark .shot.pad{background:#22262b}
.mark{position:absolute;background:#2f4f8f;opacity:.1;-webkit-mask:url(${GLYPH}) center/contain no-repeat}
pre{font:500 13.5px/1.55 'Cascadia Mono','Consolas',monospace;color:#1d2a40;white-space:pre-wrap;padding:26px 28px}
.chip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(138,166,230,.18);color:#2f4f8f;font-weight:700;font-size:15px}
.dark .chip{background:rgba(169,192,242,.14);color:#c5d5f7}`;

const scene = (w, h, body, dark = false) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>:root{--w:${w}px;--h:${h}px}${BASE}</style></head><body class="${dark ? 'dark' : ''}">${body}</body></html>`;
const txtSample = clip.split('\n').slice(0, 14).join('\n');

const SCENES = {
  '01-copy-button.png': [
    1280,
    800,
    `
    <div style="position:absolute;left:84px;top:84px" class="brand"><span class="glyph"></span>еКонспект</div>
    <div style="position:absolute;left:84px;top:200px;width:430px">
      <h1>Копируйте вопрос одним нажатием</h1>
      <p class="lead">Кнопка у каждого вопроса: текст, варианты ответа и тип вопроса сразу попадают в буфер обмена. Вопросы с фото и аудиозаписью расширение отметит.</p>
      <div style="margin-top:34px;display:flex;gap:10px;flex-wrap:wrap"><span class="chip">Один вариант</span><span class="chip">Соответствие</span><span class="chip">Пропуски</span></div>
    </div>
    <div class="shot pad" style="position:absolute;right:70px;top:100px;width:620px"><img src="${raw('light-q1.png')}"></div>`,
  ],
  '02-txt-export.png': [
    1280,
    800,
    `
    <div style="position:absolute;left:84px;top:84px" class="brand"><span class="glyph"></span>еКонспект</div>
    <div style="position:absolute;left:84px;top:200px;width:400px">
      <h1 style="font-size:46px">Весь тест — в&nbsp;один аккуратный файл</h1>
      <p class="lead">Номера и порядок как на сайте, варианты, пропуски. Знак «!» отмечает вопросы, где без видео или лекции ответ будет догадкой.</p>
    </div>
    <div class="shot" style="position:absolute;left:520px;top:120px;width:368px"><img src="${raw('light-popup.png')}"></div>
    <div class="shot" style="position:absolute;right:48px;top:250px;width:430px;transform:rotate(1.2deg)"><pre>${esc(txtSample)}</pre></div>`,
  ],
  '03-media-notes.png': [
    1280,
    800,
    `
    <div style="position:absolute;left:84px;top:84px" class="brand"><span class="glyph"></span>еКонспект</div>
    <div style="position:absolute;left:84px;top:200px;width:430px">
      <h1>Аудио, видео и фото — не потеряются</h1>
      <p class="lead">Расширение помечает то, что нельзя передать текстом, и оставляет в файле понятные метки вроде [аудио: meeting.mp3].</p>
    </div>
    <div class="shot pad" style="position:absolute;right:70px;top:170px;width:620px"><img src="${raw('light-q3.png')}"></div>`,
  ],
  '04-dark.png': [
    1280,
    800,
    `
    <div style="position:absolute;left:84px;top:84px" class="brand"><span class="glyph"></span>еКонспект</div>
    <div style="position:absolute;left:84px;top:200px;width:350px">
      <h1>Светлая и тёмная тема</h1>
      <p class="lead">Интерфейс и иконка подстраиваются под тему браузера и сайта. Данные не покидают ваш браузер.</p>
    </div>
    <div class="shot" style="position:absolute;left:480px;top:96px;width:368px"><img src="${raw('dark-popup.png')}"></div>
    <div class="shot pad" style="position:absolute;right:48px;top:250px;width:540px"><img src="${raw('dark-q1.png')}"></div>`,
    true,
  ],
  'promo-440x280.png': [
    440,
    280,
    `
    <div style="position:absolute;left:34px;top:34px" class="brand"><span class="glyph" style="width:22px;height:22px"></span>еКонспект</div>
    <div style="position:absolute;left:34px;top:92px;right:30px"><h1 style="font-size:27px">Вопросы теста —<br>в один файл</h1>
    <p style="margin-top:14px;font-size:14px;color:#6f6253">Для подготовки к экзаменам</p></div>
    <div class="mark" style="width:190px;height:190px;right:-30px;bottom:-34px"></div>`,
  ],
  'marquee-1400x560.png': [
    1400,
    560,
    `
    <div style="position:absolute;left:96px;top:90px" class="brand"><span class="glyph"></span>еКонспект</div>
    <div style="position:absolute;left:96px;top:170px;width:560px"><h1 style="font-size:52px">Вопросы теста — в один файл</h1>
    <p class="lead">Копирование одним нажатием, выгрузка всего теста, снимки вопросов с фото.</p></div>
    <div class="shot pad" style="position:absolute;right:90px;top:64px;width:580px"><img src="${raw('light-q1.png')}"></div>`,
  ],
};

const browser = await chromium.launch({ channel: 'chromium' });
for (const [name, [w, h, body, dark]] of Object.entries(SCENES)) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(scene(w, h, body, dark), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, name) });
  await page.close();
}
await browser.close();
console.log('store/: ' + Object.keys(SCENES).join(', '));
