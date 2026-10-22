import type { NavPage, PageMeta, PageMode, Question, SummaryRow } from './types';
import { clean, textOf } from './text';
import { parseQuestion } from './question';

export function detectMode(url: string, doc: Document): PageMode | null {
  const path = safeUrl(url)?.pathname ?? '';
  if (/\/mod\/quiz\/attempt\.php$/.test(path)) return 'attempt';
  if (/\/mod\/quiz\/review\.php$/.test(path)) return 'review';
  const bodyId = doc.body?.id ?? '';
  if (bodyId === 'page-mod-quiz-attempt') return 'attempt';
  if (bodyId === 'page-mod-quiz-review') return 'review';
  return null;
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function getQuestionElements(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('div.que[id^="question-"], div.que')).filter(
    (el, i, arr) => arr.indexOf(el) === i && !el.parentElement?.closest('.que'),
  );
}

export function parsePageMeta(doc: Document, url: string): PageMeta {
  const u = safeUrl(url);
  const mode = detectMode(url, doc);

  const quizTitle =
    textOf(doc.querySelector('.page-header-headings h1, #page-header h1, h1')) ||
    textOf(doc.querySelector('.breadcrumb a[aria-current="page"]')) ||
    clean(doc.title.split(/\s+[(|]/)[0]) ||
    'Тест';

  const courseLink = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.breadcrumb a')).find((a) => /\/course\/view\.php/.test(a.getAttribute('href') || ''));
  const course = clean(courseLink?.getAttribute('title') || '') || textOf(courseLink);
  // Тема (раздел курса) из навигационной цепочки: нейросети она подсказывает, о чём вопросы.
  const sectionLink = doc.querySelector('.breadcrumb a[data-section-name-for]');
  const section = textOf(sectionLink);
  const sectionId = sectionLink?.getAttribute('data-section-name-for') || null;

  const attemptId = u?.searchParams.get('attempt') || doc.querySelector<HTMLInputElement>('input[name="attempt"]')?.value || findParam(doc, 'attempt');
  const cmid = u?.searchParams.get('cmid') || (doc.body?.className.match(/\bcmid-(\d+)/)?.[1] ?? null) || findParam(doc, 'cmid');

  const showAll = u?.searchParams.get('showall') === '1' || u?.searchParams.get('showall') === 'true';
  const buttons = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.qn_buttons .qnbutton, #mod_quiz_navblock .qnbutton'));
  const byPage = new Map<number, NavPage>();
  let totalQuestions = 0;
  let currentPage = Number(u?.searchParams.get('page') ?? 0) || 0;
  let thisPageSeen = false;
  const origin = u?.origin ?? '';
  const script = mode === 'review' ? 'review.php' : 'attempt.php';
  for (const b of buttons) {
    const page = Number(b.getAttribute('data-quiz-page') ?? NaN);
    const num = buttonNumber(b);
    if (num !== 'i') totalQuestions++;
    if (Number.isNaN(page)) continue;
    if (b.classList.contains('thispage') && !thisPageSeen) {
      currentPage = page;
      thisPageSeen = true;
    }
    let entry = byPage.get(page);
    if (!entry) {
      const qs = new URLSearchParams();
      if (attemptId) qs.set('attempt', attemptId);
      if (cmid) qs.set('cmid', cmid);
      if (page > 0) qs.set('page', String(page));
      entry = { page, url: `${origin}/mod/quiz/${script}?${qs}`, numbers: [] };
      byPage.set(page, entry);
    }
    entry.numbers.push(num);
  }
  const pages = Array.from(byPage.values()).sort((a, b) => a.page - b.page);
  if (!totalQuestions) totalQuestions = getQuestionElements(doc).filter((q) => !q.classList.contains('description')).length;

  return {
    mode,
    quizTitle,
    course,
    section,
    sectionId,
    url,
    attemptId: attemptId || null,
    cmid: cmid || null,
    currentPage: showAll ? -1 : currentPage,
    pages,
    totalQuestions,
    freeNavigation: buttons.length > 0 && buttons.every((b) => !b.classList.contains('sequential')) && buttons.some((b) => b.classList.contains('free')),
    showAll,
  };
}

function buttonNumber(b: Element): string {
  const clone = b.cloneNode(true) as Element;
  clone.querySelectorAll('.accesshide, .sr-only, .visually-hidden, .trafficlight, .thispageholder').forEach((n) => n.remove());
  const t = clean(clone.textContent || '');
  const title = b.getAttribute('title') || '';
  // Информационный блок: «Инфо» / «i» / title «Информация - …».
  if (/^(инфо|info|i)$/i.test(t) || /^(Информация|Information)\b/i.test(title)) return 'i';
  if (t) return t;
  const m = title.match(/(?:Вопрос|Question)\s+(\S+)/i);
  return m ? m[1] : '?';
}

/** Сводка попытки на странице просмотра: Moove (.moove-infobox) или стандартная таблица. */
export function parseAttemptSummary(doc: ParentNode): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const box of Array.from(doc.querySelectorAll('.quizreviewsummary .moove-infobox'))) {
    const title = clean(box.querySelector('.moove-infobox-title')?.textContent || '');
    const value = clean(box.querySelector('[class*="moove-infobox-content"]')?.textContent || '');
    if (title && value) rows.push({ title, value });
  }
  if (!rows.length) {
    for (const tr of Array.from(doc.querySelectorAll('table.quizreviewsummary tr'))) {
      const title = clean(tr.querySelector('th')?.textContent || '');
      const value = clean(tr.querySelector('td')?.textContent || '');
      if (title && value) rows.push({ title, value });
    }
  }
  return rows;
}

export interface ViewPageInfo {
  quizTitle: string;
  /** Ссылки «Просмотр» завершённых попыток. */
  reviewLinks: string[];
  /** Преподаватель закрыл просмотр («Не разрешается» / «Доступные …»). */
  reviewBlocked: boolean;
  /** Есть кнопка «Продолжить попытку» / «Пройти тест». */
  canAttempt: boolean;
}

/** Страница теста mod/quiz/view.php: можно ли посмотреть попытки. */
export function parseViewPage(doc: Document): ViewPageInfo {
  const main = doc.querySelector('[role="main"], #region-main') ?? doc.body;
  const reviewLinks = Array.from(main.querySelectorAll<HTMLAnchorElement>('a[href*="/mod/quiz/review.php?attempt="]'))
    .map((a) => a.href || a.getAttribute('href') || '')
    .filter((h, i, arr) => h && arr.indexOf(h) === i);
  const text = clean(main.textContent || '');
  return {
    quizTitle: textOf(doc.querySelector('.page-header-headings h1, h1')),
    reviewLinks,
    reviewBlocked: !!main.querySelector('.noreviewmessage') || /Не разрешается|Доступн\S* \d/.test(text),
    canAttempt: !!main.querySelector('form[action*="startattempt.php"], a[href*="startattempt.php"], a[href*="attempt.php?attempt="]'),
  };
}

function findParam(doc: Document, name: string): string | null {
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/mod/quiz/"]'))) {
    const m = (a.getAttribute('href') || '').match(new RegExp(`[?&]${name}=(\\d+)`));
    if (m) return m[1];
  }
  return null;
}

export function parseQuestions(root: ParentNode, opts: { withResults?: boolean } = {}): Question[] {
  return getQuestionElements(root).map((el) => parseQuestion(el, opts));
}

/** Есть ли на странице хоть какие-то правильные ответы (для честной пометки в TXT). */
export function hasRightAnswers(root: ParentNode): boolean {
  return (
    !!root.querySelector('.que .rightanswer') ||
    Array.from(root.querySelectorAll('.que [data-bs-content], .que [data-content]')).some((a) =>
      /Правильн\S* ответ/i.test(a.getAttribute('data-bs-content') || a.getAttribute('data-content') || ''),
    )
  );
}

/** Сравнение номеров вопросов «2» < «10», информационные блоки — по месту. */
export function compareNumbers(a: string, b: string): number {
  const na = Number(a),
    nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b, 'ru', { numeric: true });
}
