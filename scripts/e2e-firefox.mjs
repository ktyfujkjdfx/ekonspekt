// Firefox E2E: настоящий Firefox (его и geckodriver скачивает Selenium Manager) + временная установка расширения.
// e.sfu-kras.ru → 127.0.0.1 (network.dns.forceResolve), локальный HTTPS (порт 443) с самоподписанным сертификатом.
// Запуск: npm run e2e:firefox   (сам собирает dist/firefox-e2e — тестовую сборку с крючком __E2E__)
import https from 'node:https';
import { readFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

import { execFileSync } from 'node:child_process';
import selfsigned from 'selfsigned';
const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PROJECT, 'dist', 'e2e-firefox');
execFileSync(process.execPath, [join(PROJECT, 'scripts', 'build.mjs'), 'firefox', '--e2e'], { stdio: 'ignore' });
const pems = await selfsigned.generate([{ name: 'commonName', value: 'e.sfu-kras.ru' }], {
  days: 2,
  keySize: 2048,
  extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'e.sfu-kras.ru' }] }],
});
mkdirSync(OUT, { recursive: true });
const FIX = join(PROJECT, 'test', 'fixtures');
const FILES = join(PROJECT, '.cache', 'moodle-css');
const XPI = join(PROJECT, 'dist', 'firefox-e2e');
import { existsSync } from 'node:fs';
const STYLE = existsSync(FILES) ? '<link rel="stylesheet" href="/__files/styles.php">' : '';
const byAttempt = {
  9258730: 'review-image.html',
  6958707: 'review-cloze-audio.html',
  7599358: 'review-video-essay.html',
  9255881: 'review-placement-120.html',
};
const attemptSrc = readFileSync(join(FIX, 'attempt-multichoice-single.html'), 'utf8');
const attemptPage = (n) =>
  attemptSrc.replaceAll('question-9868405-10', `question-9868405-${n + 1}`).replace('<span class="rui-qno">10</span>', `<span class="rui-qno">${n + 1}</span>`);
const requests = [];

const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
  const u = new URL(req.url, 'https://e.sfu-kras.ru');
  requests.push(`${req.method} ${u.pathname}${u.search} cookie=${req.headers.cookie ?? '-'}`);
  const html = (body) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'MoodleSession=test; Path=/; Secure; SameSite=Lax' });
    res.end(body);
  };
  try {
    if (u.pathname.startsWith('/__files/')) {
      res.writeHead(200, { 'content-type': 'text/css' });
      return res.end(readFileSync(join(FILES, decodeURIComponent(u.pathname.slice(9)))));
    }
    if (u.pathname === '/mod/quiz/review.php')
      return html(readFileSync(join(FIX, byAttempt[u.searchParams.get('attempt')]), 'utf8').replace('</head>', STYLE + '</head>'));
    if (u.pathname === '/mod/lesson/view.php') {
      const f = { 525642: 'lesson-content.html', 525643: 'lesson-question-single.html', 525646: 'lesson-content-image.html', '-9': 'lesson-end.html' }[
        u.searchParams.get('pageid')
      ];
      if (f) return html(readFileSync(join(FIX, f), 'utf8'));
    }
    if (u.pathname === '/mod/quiz/attempt.php') return html(attemptPage(Number(u.searchParams.get('page') ?? 0)).replace('</head>', STYLE + '</head>'));
    if (u.pathname.startsWith('/pluginfile.php/')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(readFileSync(join(PROJECT, 'icons', 'ink', 'icon-128.png')));
    }
  } catch {
    /* 404 ниже */
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(443, '127.0.0.1', r));

const UUID = '6a1c3f6e-1111-4c4c-9999-0123456789ab';
const manifest = JSON.parse(readFileSync(join(PROJECT, 'dist', 'firefox', 'manifest.json'), 'utf8'));
const addonId = manifest.browser_specific_settings.gecko.id;
const opts = new firefox.Options()
  .addArguments('-headless')
  .setPreference('network.dns.forceResolve', '127.0.0.1')
  .setPreference('network.trr.mode', 5)
  .setPreference('extensions.webextensions.uuids', JSON.stringify({ [addonId]: UUID }))
  .setPreference('browser.download.folderList', 2)
  .setPreference('browser.download.dir', OUT.replace(/\//g, '\\'))
  .setPreference('browser.download.useDownloadDir', true)
  .setPreference('browser.download.always_ask_before_handling_new_types', false)
  .setPreference('dom.events.asyncClipboard.readText', true)
  .setPreference('dom.events.testing.asyncClipboard', true);
opts.setAcceptInsecureCerts(true);
opts.setBrowserVersion('stable');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
const log = (...a) => console.log('*', ...a);
try {
  const caps = await driver.getCapabilities();
  log('Firefox', caps.get('browserVersion'));
  await driver.installAddon(XPI, true);

  // review с аудио: кнопка, копирование
  await driver.get('https://e.sfu-kras.ru/mod/quiz/review.php?attempt=6958707&cmid=1');
  const panel = await driver.wait(until.elementLocated(By.css('.que ecx-panel')), 15000);
  const shadow = await panel.getShadowRoot();
  const btn = await shadow.findElement(By.css('button.copy'));
  await btn.click();
  await driver.sleep(300);
  log('кнопка после клика:', await btn.getAttribute('class'));
  const clip = await driver.executeAsyncScript('const cb = arguments[arguments.length-1]; navigator.clipboard.readText().then(cb, (e) => cb("ERR " + e));');
  log('буфер:', String(clip).split('\n').slice(1, 3).join(' / '));

  // Команды контент-скрипту через тестовый крючок (сборка --e2e).
  const send = (msg) =>
    driver.executeAsyncScript(
      `
    const cb = arguments[arguments.length - 1];
    const id = Math.random();
    window.addEventListener('message', function on(e) { if (e.data && e.data.ecxE2EResult && e.data.id === id) { window.removeEventListener('message', on); cb(JSON.stringify(e.data.ecxE2EResult)); } });
    window.postMessage({ ecxE2E: true, id, msg: arguments[0] }, '*');`,
      msg,
    );
  await driver.manage().setTimeouts({ script: 120000 });
  log('status:', (await send({ type: 'status' })).slice(0, 200));
  log('export zip:', await send({ type: 'export', zip: true, includeResults: true }));

  await driver.get('https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=9437135&cmid=1444264&page=9');
  await driver.wait(until.elementLocated(By.css('.que ecx-panel')), 15000);
  log('collect:', await send({ type: 'collectAttemptPages' }));
  log('export txt:', await send({ type: 'export', zip: false, includeResults: false }));
  // «С картинкой»: текст и снимок вопроса в буфере.
  await driver.get('https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9258730&cmid=1');
  const panels = await driver.wait(until.elementsLocated(By.css('.que ecx-panel')), 15000);
  let imgBtn = null;
  for (const pnl of panels) {
    const found = await (await pnl.getShadowRoot()).findElements(By.css('button.copy.img'));
    if (found.length) {
      imgBtn = found[0];
      break;
    }
  }
  log('кнопка «С картинкой»:', imgBtn ? 'есть' : 'НЕТ');
  if (imgBtn) {
    await imgBtn.click();
    await driver.wait(async () => /done|fail/.test(await imgBtn.getAttribute('class')), 20000);
    const types = await driver.executeAsyncScript(`const cb = arguments[arguments.length-1];
      navigator.clipboard.read().then(async (items) => { const o = []; for (const it of items) for (const t of it.types) o.push(t + ':' + (await it.getType(t)).size); cb(o.join(', ')); }, (e) => cb('ERR ' + e));`);
    log('буфер «С картинкой»:', await imgBtn.getAttribute('class'), '|', types);
  }
  // Лекция: страницы запоминаются, конспект с рисунками.
  for (const id of ['525642', '525643', '525646', '-9']) {
    await driver.get('https://e.sfu-kras.ru/mod/lesson/view.php?id=1769636&pageid=' + id);
    if (id !== '-9') await driver.wait(until.elementLocated(By.css('ecx-panel[data-ecx-lesson]')), 15000);
    else await driver.sleep(800);
  }
  log('лекция status:', (await send({ type: 'status' })).slice(0, 220));
  log('лекция zip:', await send({ type: 'export', zip: true, includeResults: false }));
  await driver.get('https://e.sfu-kras.ru/mod/lesson/view.php?id=1769636&pageid=525646');
  await driver.wait(until.elementLocated(By.css('ecx-panel[data-ecx-lesson]')), 15000);
  const n0 = requests.length;
  log('лекция, собрать всю:', await send({ type: 'collectLesson' }));
  const crawl = requests.slice(n0);
  log(
    'лекция, запросов при сборе:',
    crawl.length,
    crawl.some((r) => /^POST|continue\.php|pageid=-9/.test(r)) ? 'ЕСТЬ POST/финал — ОШИБКА' : 'только GET страниц',
  );
  // popup визуально
  await driver.get('https://e.sfu-kras.ru/mod/quiz/review.php?attempt=7599358&cmid=1');
  await driver.wait(until.elementLocated(By.css('.que ecx-panel')), 15000);
  log('export zip с фото:', await send({ type: 'export', zip: true, includeResults: false }));
  const png = await (await driver.findElement(By.css('.que'))).takeScreenshot();
  (await import('node:fs')).writeFileSync(join(OUT, 'ff-question.png'), Buffer.from(png, 'base64'));
  await driver.sleep(1500);
  log(
    'файлы:',
    readdirSync(OUT)
      .filter((f) => /\.(zip|txt)$/.test(f))
      .map((f) => `${f} (${statSync(join(OUT, f)).size} Б)`)
      .join(' | '),
  );
  log(
    'GET attempt с cookie:',
    requests
      .filter((r) => r.includes('attempt.php'))
      .map((r) => r.split(' cookie=')[1])
      .join(','),
  );
} finally {
  await driver.quit();
  server.close();
}
