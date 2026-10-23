import { ext, fromOurExtension, SITE_ORIGIN } from '../shared/api';
import { getSettings, setSettings } from '../shared/settings';
import type { LessonStatus, ProgressMessage, QuizStatus, Request, Response } from '../shared/messages';
import type { ViewPageInfo } from '../parser/page';
import { reportBrowserTheme } from '../shared/theme';
import { browserName, composeUrl, MAILERS, placeOf, PROMPTS, SUPPORT_EMAIL, type MailerId, type SupportKind } from '../shared/support';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let tabId: number | undefined;
let status: QuizStatus | null = null;
let lesson: LessonStatus | null = null;
let currentUrl = '';
let lessonWarned = false;

function showMessage(text: string, isError = false) {
  const m = $('message');
  const p = document.createElement('p');
  p.textContent = text;
  m.replaceChildren(p);
  m.className = 'card note rise' + (isError ? ' error' : '');
  m.hidden = false;
  $('quiz').hidden = true;
  for (const id of ['zipRow', 'resultsRow']) $(id).hidden = true;
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10,
    b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

async function send(msg: Request): Promise<Response> {
  if (tabId == null) throw new Error('no tab');
  return (await ext.tabs.sendMessage(tabId, msg)) as Response;
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Плавный счётчик для крупной цифры. */
function countTo(el: HTMLElement, to: number) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = String(to);
  if (reduceMotion || from === to) {
    el.textContent = String(to);
    return;
  }
  const t0 = performance.now();
  const dur = 650;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let restoreTimer: number | undefined;
/** Полоска в кнопке только растёт, пока идёт одна выгрузка. */
let barPct = 0;

/** Ход выгрузки показываем прямо в главной кнопке: окно не меняет высоту. */
function setProgress(p: { text: string; done?: number; total?: number; finished?: boolean; error?: string }) {
  const btn = $('downloadBtn');
  clearTimeout(restoreTimer);
  btn.classList.toggle('indeterminate', !p.finished && !p.total && !barPct);
  btn.classList.toggle('done', !!p.finished && !p.error);
  btn.classList.toggle('error', !!p.error);
  btn.querySelector('.cta-sub')!.textContent = p.text;
  if (p.finished) barPct = p.error ? 0 : 100;
  else if (p.total) barPct = Math.max(barPct, Math.round(((p.done ?? 0) / p.total) * 100));
  (btn.querySelector('.bar i') as HTMLElement).style.width = `${barPct}%`;
  if (p.finished) {
    restoreTimer = window.setTimeout(
      () => {
        barPct = 0;
        btn.classList.remove('done', 'error', 'indeterminate');
        (btn.querySelector('.bar i') as HTMLElement).style.width = '';
        updateDownloadLabel();
      },
      p.error ? 6000 : 3500,
    );
  }
}

function setBusy(b: boolean) {
  const btn = $<HTMLButtonElement>('downloadBtn');
  btn.disabled = b;
  btn.classList.toggle('busy', b);
  $<HTMLButtonElement>('collectBtn').disabled = b;
}

function render(s: QuizStatus, settings: Awaited<ReturnType<typeof getSettings>>) {
  $('message').hidden = true;
  $('quiz').hidden = false;
  $('title').textContent = s.quizTitle;
  $('course').textContent = s.course;
  $('course').title = s.course;
  $('title').title = s.quizTitle;

  const review = s.mode === 'review';
  countTo($('found'), review ? s.total : s.found);
  $('ofTotal').textContent = review ? '' : `/${s.total}`;
  $('foundLabel').textContent = review ? plural(s.total, 'вопрос в тесте', 'вопроса в тесте', 'вопросов в тесте') : 'собрано вопросов';

  const c = s.counts;
  const base = Math.max(1, c.single + c.multi + c.match + c.other);
  const items: [string, number, 'alert' | 'more' | ''][] = [
    ['Один вариант', c.single, ''],
    ['Несколько вариантов', c.multi, ''],
    ['Выбор / соответствие', c.match, ''],
    ['Другие типы', c.other, c.others?.length ? 'more' : ''],
  ];
  if (c.photo) items.push(['С фото', c.photo, 'alert']);
  if (c.media) items.push(['Аудио / видео', c.media, 'alert']);
  $('counts').replaceChildren(
    ...items.map(([label, n, kind], i) => {
      const li = document.createElement('li');
      li.className = (n ? '' : 'zero') + (kind === 'alert' && n ? ' alert' : '');
      const name = document.createElement('span');
      name.textContent = label;
      const num = document.createElement('b');
      num.textContent = String(n);
      const bar = document.createElement('i');
      bar.style.setProperty('--d', `${i * 50}ms`);
      if (kind === 'more') {
        // «Другие типы» открываются соседней панелью внутри той же карточки: высота окна не меняется.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'more';
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', 'others');
        btn.title = 'Показать, какие это типы';
        const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chev.setAttribute('viewBox', '0 0 16 16');
        chev.classList.add('chev');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', 'm6 3.5 4.5 4.5L6 12.5');
        chev.append(p);
        btn.append(name, num, chev);
        btn.addEventListener('click', () => showOthers(true));
        li.append(btn, bar);
        $('othersList').replaceChildren(
          ...c.others.map(([t, k]) => {
            const it = document.createElement('li');
            const tn = document.createElement('span');
            tn.textContent = t.charAt(0).toUpperCase() + t.slice(1);
            const tk = document.createElement('b');
            tk.textContent = String(k);
            it.append(tn, tk);
            return it;
          }),
        );
      } else {
        li.append(name, num, bar);
      }
      // Ширину задаём в следующем кадре — полоска «вырастает».
      requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty('--w', `${Math.round((n / base) * 100)}%`)));
      return li;
    }),
  );

  const note = $('collectNote');
  if (review) {
    note.hidden = s.found >= s.total;
    note.textContent = `Здесь видно ${s.found} из ${s.total}. Остальные расширение загрузит само при скачивании.`;
  } else {
    note.hidden = s.missingNumbers.length === 0;
    const miss = s.missingNumbers;
    const list =
      miss
        .slice(0, 6)
        .map((n) => '№' + n)
        .join(', ') + (miss.length > 6 ? ` и ещё ${miss.length - 6}` : '');
    note.textContent = `Пока нет: ${list}. Пролистайте эти страницы — вопросы запомнятся.`;
  }
  $('attemptFetch').hidden = !(s.mode === 'attempt' && s.missingNumbers.length > 0 && s.freeNavigation);

  $('zipRow').hidden = false;
  $<HTMLInputElement>('zip').checked = settings.zip;
  $<HTMLInputElement>('showButtons').checked = settings.showButtons;
  $('resultsRow').hidden = !review;
  $<HTMLInputElement>('includeResults').checked = settings.includeResults;
  updateResultsHint(settings.includeResults);
  if (!$('downloadBtn').classList.contains('done') && !$('downloadBtn').classList.contains('error')) updateDownloadLabel();
  setBusy(s.busy);
}

/** Подпись под «Мои ответы»: предупреждаем, если правильные ответы преподаватель скрыл. */
function updateResultsHint(on: boolean) {
  if (lesson) {
    $('resultsHint').textContent = on ? `ваши ответы: ${lesson.answers} из ${lesson.questions}` : 'только вопросы, без ответов';
    $('resultsHint').classList.remove('warn');
    return;
  }
  const noRight = status?.mode === 'review' && on && !status.rightAnswersShown;
  const hint = $('resultsHint');
  hint.textContent = noRight ? 'правильные ответы скрыты' : 'верно / неверно и баллы';
  hint.classList.toggle('warn', noRight);
}

/** Переключение между списком типов и панелью «Другие типы». */
function showOthers(open: boolean) {
  $('panes').classList.toggle('show-others', open);
  $('others').setAttribute('aria-hidden', String(!open));
  $('othersBack').tabIndex = open ? 0 : -1;
  $('counts').toggleAttribute('inert', open);
  const more = document.querySelector<HTMLButtonElement>('#counts .more');
  more?.setAttribute('aria-expanded', String(open));
  (open ? $('othersBack') : more)?.focus({ preventScroll: true });
}

function updateDownloadLabel() {
  const zip = $<HTMLInputElement>('zip').checked;
  const btn = $('downloadBtn');
  if (lesson) {
    btn.querySelector('.cta-label')!.textContent = 'Скачать конспект';
    btn.querySelector('.cta-sub')!.textContent = zip ? 'текст лекции и рисунки (ZIP)' : 'вся лекция одним файлом';
    return;
  }
  const n = status?.lectures ?? 0;
  const plus = n ? ` + ${n} ${plural(n, 'лекция', 'лекции', 'лекций')} темы` : '';
  btn.querySelector('.cta-label')!.textContent = zip ? 'Скачать ZIP' : 'Скачать TXT';
  btn.querySelector('.cta-sub')!.textContent = zip ? `TXT и снимки вопросов${plus}` : `все вопросы одним файлом${plus}`;
}

/** Лекция: конспект собирается, пока студент листает страницы. */
function renderLesson(ls: LessonStatus, settings: Awaited<ReturnType<typeof getSettings>>) {
  lesson = ls;
  $('message').hidden = true;
  $('quiz').hidden = false;
  $('title').textContent = ls.title;
  $('title').title = ls.title;
  $('course').textContent = ls.course;
  $('course').title = ls.course;
  countTo($('found'), ls.pages);
  $('ofTotal').textContent = ls.menuTotal ? `/${ls.menuTotal}` : '';
  $('foundLabel').textContent = plural(ls.pages, 'страница в конспекте', 'страницы в конспекте', 'страниц в конспекте');

  const items: [string, number, boolean][] = [
    ['Текст лекции', ls.content, false],
    ['Вопросы', ls.questions, false],
    ['Рисунки', ls.images, false],
  ];
  if (ls.media) items.push(['Видео / аудио', ls.media, true]);
  const base = Math.max(1, ...items.map(([, n]) => n));
  $('counts').replaceChildren(
    ...items.map(([label, n, alert], i) => {
      const li = document.createElement('li');
      li.className = (n ? '' : 'zero') + (alert && n ? ' alert' : '');
      const name = document.createElement('span');
      name.textContent = label;
      const num = document.createElement('b');
      num.textContent = String(n);
      const bar = document.createElement('i');
      bar.style.setProperty('--d', `${i * 50}ms`);
      li.append(name, num, bar);
      requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty('--w', `${Math.round((n / base) * 100)}%`)));
      return li;
    }),
  );

  const note = $('collectNote');
  note.hidden = false;
  note.textContent = !ls.pages
    ? 'Листайте лекцию — каждая открытая страница сама попадёт в конспект.'
    : ls.finished && ls.approxOrder
      ? 'Часть страниц собрана без вас, их порядок примерный. Для точного: «Пересмотр лекции» на последней странице и пролистать — оценка не изменится.'
      : ls.finished
        ? ls.questions > ls.answers
          ? 'Лекция пройдена. «Собрать всю лекцию» добавит недостающие страницы и ваши ответы.'
          : 'Лекция пройдена. Если каких-то страниц не хватает — «Собрать всю лекцию».'
        : `Пройдено ${ls.progress ?? 0}%. Назад листать не нужно: открытые страницы уже в конспекте.`;
  // Собрать недостающие страницы (в том числе открытые до установки расширения и те, куда «назад» не вернуться).
  $('attemptFetch').hidden = !ls.pages;
  if (!lessonWarned) $('collectLabel').textContent = 'Собрать всю лекцию';
  $('resultsRow').hidden = !(ls.answers || ls.finished);
  $<HTMLInputElement>('includeResults').checked = settings.includeResults;
  updateResultsHint(settings.includeResults);
  $('zipRow').hidden = false;
  $('zipTitle').textContent = 'Рисунки в ZIP';
  $('zipHint').textContent = 'схемы и картинки лекции';
  $('buttonsHint').textContent = '«Копировать» страницу, вопрос, код';
  $<HTMLInputElement>('zip').checked = settings.zip;
  $<HTMLInputElement>('showButtons').checked = settings.showButtons;
  $<HTMLButtonElement>('downloadBtn').disabled = !ls.pages || ls.busy;
  if (!$('downloadBtn').classList.contains('done') && !$('downloadBtn').classList.contains('error')) updateDownloadLabel();
}

async function refreshLesson() {
  const settings = await getSettings();
  try {
    const r = await send({ type: 'status' });
    if (!r.ok || !r.lesson) throw new Error('no lesson');
    renderLesson(r.lesson, settings);
  } catch {
    // continue.php — ответ на отправленную форму: перезагрузка отправила бы ответ повторно. Только подсказка.
    if (/continue\.php/.test(currentUrl)) showMessage('Перейдите на следующую страницу лекции — расширение подключится и запомнит её.');
    else showReload('Страница лекции открыта раньше, чем расширение успело на ней запуститься. Обновите её — прогресс лекции не изменится.');
  }
}

async function refresh() {
  const settings = await getSettings();
  try {
    const r = await send({ type: 'status' });
    if (!r.ok || !r.status) throw new Error(r.ok ? 'no status' : r.error);
    status = r.status;
    render(r.status, settings);
  } catch {
    showReload();
  }
}

/** Страница открыта до установки/обновления расширения: предлагаем обновить её одной кнопкой. */
function showReload(text = 'Страница теста открыта раньше, чем расширение успело на ней запуститься. Обновите её — вопросы останутся на месте.') {
  showMessage(text);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Обновить страницу';
  b.addEventListener('click', async () => {
    if (tabId != null) await ext.tabs.reload(tabId);
    window.close();
  });
  $('message').append(b);
}

let supportKind: SupportKind = 'bug';
/** Почта студента: запоминаем выбор — в следующий раз она на главной кнопке. */
let supportMailer: MailerId = 'gmail';
const MAILER_KEY = 'supportMailer';

function supportOpen(open: boolean) {
  const sheet = $('support');
  document.body.classList.toggle('support-open', open);
  sheet.setAttribute('aria-hidden', String(!open));
  $('supportOpen').setAttribute('aria-expanded', String(open));
  document.querySelector('main')?.toggleAttribute('inert', open);
  sheet.querySelectorAll<HTMLElement>('button, a').forEach((el) => {
    el.tabIndex = open ? 0 : -1;
  });
  if (open) {
    // Высота содержимого панели (сама панель растянута на окно): низ последнего блока + отступ.
    const need = Math.ceil((sheet.lastElementChild?.getBoundingClientRect().bottom ?? 0) - sheet.getBoundingClientRect().top + sheet.scrollTop + 18);
    if (need > document.body.getBoundingClientRect().height) document.body.style.minHeight = `${need}px`;
    $('supportMail').focus({ preventScroll: true });
  } else {
    $('supportOpen').focus({ preventScroll: true });
  }
}

function supportRender() {
  const ctx = { version: ext.runtime.getManifest().version, browser: browserName(navigator.userAgent), place: placeOf(currentUrl) };
  document.querySelectorAll<HTMLButtonElement>('#support .seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === supportKind)));
  $('supportTips').replaceChildren(
    ...PROMPTS[supportKind].map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
  $('supportAttach').hidden = supportKind === 'question';

  const main = MAILERS.find((m) => m.id === supportMailer) ?? MAILERS[0];
  const mail = $<HTMLAnchorElement>('supportMail');
  mail.href = composeUrl(main.id, supportKind, ctx);
  mail.dataset.mailer = main.id;
  $('supportMailLabel').textContent = main.label;
  const open = document.body.classList.contains('support-open');
  $('supportOther').replaceChildren(
    ...MAILERS.filter((m) => m.id !== main.id).map((m) => {
      const a = document.createElement('a');
      a.href = composeUrl(m.id, supportKind, ctx);
      a.target = '_blank';
      a.rel = 'noopener';
      a.dataset.mailer = m.id;
      a.textContent = m.short;
      a.tabIndex = open ? 0 : -1;
      return a;
    }),
  );
}

function initSupport() {
  $('supportAddr').textContent = SUPPORT_EMAIL;
  supportRender();
  void ext.storage.local.get(MAILER_KEY).then(
    (r) => {
      const saved = r?.[MAILER_KEY] as MailerId | undefined;
      if (saved && MAILERS.some((m) => m.id === saved)) {
        supportMailer = saved;
        supportRender();
      }
    },
    () => {},
  );
  $('supportOpen').addEventListener('click', () => supportOpen(true));
  $('supportBack').addEventListener('click', () => supportOpen(false));
  document.querySelectorAll<HTMLButtonElement>('#support .seg button').forEach((b) =>
    b.addEventListener('click', () => {
      supportKind = b.dataset.kind as SupportKind;
      supportRender();
    }),
  );
  // Выбранную почту запоминаем: она станет главной кнопкой в следующий раз.
  $('support').addEventListener('click', (e) => {
    const link = (e.target as Element).closest<HTMLAnchorElement>('a[data-mailer]');
    if (!link) return;
    supportMailer = link.dataset.mailer as MailerId;
    void ext.storage.local.set({ [MAILER_KEY]: supportMailer });
    setTimeout(supportRender, 0);
  });
  $('supportCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      $('supportCopy').classList.add('copied');
      $('supportCopyLabel').textContent = 'Скопировано ✓';
      setTimeout(() => {
        $('supportCopy').classList.remove('copied');
        $('supportCopyLabel').textContent = 'Скопировать';
      }, 1800);
    } catch {
      /* адрес и так виден и выделяется целиком */
    }
  });
}

async function init() {
  reportBrowserTheme();
  initSupport();
  const settings = await getSettings();
  ($('showButtons') as HTMLInputElement).checked = settings.showButtons;

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  const url = tab?.url ?? '';
  currentUrl = url;
  supportRender(); // «где открыто» в служебной строке письма
  if (!url.startsWith(SITE_ORIGIN + '/')) {
    showMessage('Откройте тест на сайте электронных курсов: страницу с вопросами или просмотр результатов.');
  } else if (/\/mod\/lesson\/(view|continue)\.php/.test(url)) {
    await refreshLesson();
  } else if (/\/mod\/quiz\/view\.php/.test(url)) {
    await renderViewPage();
  } else if (/\/mod\/quiz\/summary\.php/.test(url)) {
    showMessage(
      'Это итог попытки. Вернитесь к вопросам — там работают кнопки и выгрузка. Или завершите тест и откройте «Просмотр»: там можно выгрузить и ваши ответы.',
    );
  } else if (!/\/mod\/quiz\/(attempt|review)\.php/.test(url)) {
    showMessage('Откройте тест: страницу с вопросами или просмотр результатов — расширение соберёт его в один файл.');
  } else {
    await refresh();
  }

  $('showButtons').addEventListener('change', (e) => setSettings({ showButtons: (e.target as HTMLInputElement).checked }));
  $('zip').addEventListener('change', (e) => {
    void setSettings({ zip: (e.target as HTMLInputElement).checked });
    updateDownloadLabel();
  });
  // Переключатели отвечают сразу: подпись меняется в том же кадре, настройка сохраняется следом.
  $('includeResults').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    updateResultsHint(on);
    void setSettings({ includeResults: on });
  });

  $('downloadBtn').addEventListener('click', async () => {
    setBusy(true);
    barPct = 0;
    setProgress({ text: 'Начинаю…', done: 0, total: 100 });
    const s = await getSettings();
    try {
      const r = await send({ type: 'export', zip: s.zip, includeResults: s.includeResults });
      setProgress(r.ok ? { text: r.message ?? 'Готово', finished: true } : { text: r.error, finished: true, error: r.error });
    } catch {
      setProgress({ text: 'Страница не ответила. Обновите её (F5) и попробуйте снова.', finished: true, error: 'x' });
    }
    setBusy(false);
  });

  $('othersBack').addEventListener('click', () => showOthers(false));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.body.classList.contains('support-open')) {
      e.preventDefault();
      supportOpen(false);
      return;
    }
    if ($('panes').classList.contains('show-others')) {
      e.preventDefault();
      showOthers(false);
    }
  });

  // Первое нажатие предупреждает (тем же местом, где подсказка), второе — собирает.
  let warned = false;
  $('collectBtn').addEventListener('click', async () => {
    const s = await getSettings();
    if (lesson) {
      if (!s.lessonFetchAck && !lessonWarned) {
        lessonWarned = true;
        $('collectNote').textContent =
          'Расширение само откроет остальные страницы лекции только для чтения: ничего не ответит и не завершит лекцию. Сайт может отметить их как просмотренные.';
        $('collectLabel').textContent = 'Понятно, собрать';
        return;
      }
      if (!s.lessonFetchAck) await setSettings({ lessonFetchAck: true });
      await runCollect('collectLesson');
      return;
    }
    if (!s.attemptFetchAck && !warned) {
      warned = true;
      const note = $('collectNote');
      note.textContent = 'Расширение откроет остальные страницы попытки только для чтения. Сайт запишет просмотры в журнал.';
      note.hidden = false;
      $('collectLabel').textContent = 'Понятно, собрать';
      return;
    }
    if (!s.attemptFetchAck) await setSettings({ attemptFetchAck: true });
    await runCollect();
  });

  ext.runtime.onMessage.addListener((m: ProgressMessage, sender) => {
    if (!fromOurExtension(sender)) return;
    if (m?.type === 'progress' && !m.finished) setProgress(m);
  });
}

/** Страница теста view.php: просмотр закрыт или есть ссылки на просмотр попыток. */
async function renderViewPage() {
  let view: ViewPageInfo | undefined;
  try {
    const r = await send({ type: 'status' });
    if (r.ok) view = r.view;
  } catch {
    /* старая вкладка без content script */
  }
  if (!view) {
    showMessage('Это страница описания теста. Откройте попытку или «Просмотр» завершённой попытки.');
    return;
  }
  const m = $('message');
  m.className = 'card note rise';
  m.hidden = false;
  $('quiz').hidden = true;
  const parts: (Node | string)[] = [];
  if (view.reviewLinks.length) {
    parts.push('Вопросы можно выгрузить со страницы просмотра попытки:');
    view.reviewLinks.forEach((href, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost';
      b.textContent = view!.reviewLinks.length > 1 ? `Открыть просмотр попытки ${i + 1}` : 'Открыть просмотр попытки';
      b.addEventListener('click', async () => {
        if (tabId != null) await ext.tabs.update(tabId, { url: href });
        window.close();
      });
      parts.push(b);
    });
  } else if (view.reviewBlocked) {
    parts.push(
      'Преподаватель закрыл просмотр попыток этого теста («Не разрешается»). Выгрузить вопросы можно только во время попытки: расширение запоминает вопросы, пока вы листаете страницы теста.',
    );
  } else {
    parts.push(
      'Это страница описания теста. Начните или продолжите попытку: кнопки «Копировать» появятся у каждого вопроса, а вопросы будут запоминаться по мере пролистывания.',
    );
  }
  m.replaceChildren(
    ...parts.map((p) => {
      if (typeof p !== 'string') return p;
      const d = document.createElement('p');
      d.textContent = p;
      return d;
    }),
  );
}

async function runCollect(type: 'collectAttemptPages' | 'collectLesson' = 'collectAttemptPages') {
  setBusy(true);
  barPct = 0;
  setProgress({ text: type === 'collectLesson' ? 'Читаю лекцию…' : 'Собираю вопросы…', done: 0, total: 100 });
  try {
    const r = await send({ type });
    setProgress(r.ok ? { text: r.message ?? 'Готово', finished: true } : { text: r.error, finished: true, error: r.error });
  } catch {
    setProgress({ text: 'Страница не ответила. Обновите её (F5).', finished: true, error: 'x' });
  }
  setBusy(false);
  if (type === 'collectLesson') await refreshLesson();
  else await refresh();
}

void init();
