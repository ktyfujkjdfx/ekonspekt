import { compareNumbers, getQuestionElements, hasRightAnswers, parsePageMeta } from '../parser/page';
import { getQuestionNumber } from '../parser/question';
import type { PageMeta } from '../parser/types';
import { fetchQuizDocument, FetchError, SessionError, sleep } from './fetchPages';
import { loadAttempt, saveQuestions } from './store';

/** Блок вопроса: живой элемент страницы или элемент из загруженного/сохранённого HTML. */
export interface Entry {
  id: string;
  number: string;
  slot: number | null;
  page: number;
  /** Позиция блока на своей странице — порядок, в котором вопросы видит студент. */
  index: number;
  el: Element;
  live: boolean;
}

export interface Collected {
  meta: PageMeta;
  entries: Entry[];
  missingNumbers: string[];
  rightAnswersShown: boolean;
}

export type Progress = (text: string, done?: number, total?: number) => void;

const pagesText = (ready: number, all: number) => `Собираю вопросы: страница ${ready} из ${all}`;

/** Паузы между пачками запросов (мс): бережём сервер. В тестах обнуляются. */
export const timing = { review: 0, attempt: 100 };
/** Сколько страниц грузим одновременно: попытка — осторожнее (сайт пишет просмотры), просмотр — смелее. */
export const parallel = { review: 6, attempt: 4 };

/**
 * Просмотр результатов: все вопросы одной страницей (showall) начинаем грузить, как только открыто окно
 * расширения, — к нажатию «Скачать» они обычно уже готовы. Держим 2 минуты.
 */
let reviewPrefetch: { url: string; at: number; doc: Promise<Document> } | null = null;
const PREFETCH_TTL = 120000;

function showAllUrl(meta: PageMeta): string | null {
  if (!meta.attemptId) return null;
  const qs = new URLSearchParams({ attempt: meta.attemptId, showall: '1' });
  if (meta.cmid) qs.set('cmid', meta.cmid);
  return `${location.origin}/mod/quiz/review.php?${qs}`;
}

export function prefetchReview(): void {
  const meta = parsePageMeta(document, location.href);
  if (meta.mode !== 'review' || meta.showAll || meta.pages.length <= 1) return;
  const url = showAllUrl(meta);
  if (!url || missing(meta, liveEntries(meta)).length === 0) return;
  if (reviewPrefetch?.url === url && Date.now() - reviewPrefetch.at < PREFETCH_TTL) return;
  const doc = fetchQuizDocument(url);
  doc.catch(() => {
    if (reviewPrefetch?.doc === doc) reviewPrefetch = null;
  });
  reviewPrefetch = { url, at: Date.now(), doc };
}

function showAllDocument(url: string): Promise<Document> {
  if (reviewPrefetch?.url === url && Date.now() - reviewPrefetch.at < PREFETCH_TTL) return reviewPrefetch.doc;
  return fetchQuizDocument(url);
}

/** Страницы пачками: внутри пачки параллельно, результаты — по порядку страниц. */
async function inChunks<T, R>(
  items: T[],
  size: number,
  pause: number,
  fn: (item: T) => Promise<R>,
  onChunk: (results: { item: T; result?: R; error?: unknown }[]) => boolean | Promise<boolean>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const results = await Promise.all(
      chunk.map((item) =>
        fn(item).then(
          (result) => ({ item, result }),
          (error) => ({ item, error }),
        ),
      ),
    );
    if (!(await onChunk(results))) return;
    if (i + size < items.length && pause) await sleep(pause);
  }
}

function entryFrom(el: Element, page: number, live: boolean, index: number): Entry {
  const m = el.id.match(/-(\d+)$/);
  return { id: el.id || `${page}-${index}`, number: getQuestionNumber(el), slot: m ? Number(m[1]) : null, page, index, el, live };
}

/**
 * Порядок как на экране: страница, затем позиция на странице.
 * Номер слота Moodle для порядка не годится: при перемешивании вопросов он не совпадает с «Вопрос N».
 */
function sortEntries(entries: Entry[]): Entry[] {
  return entries.sort((a, b) => a.page - b.page || a.index - b.index || compareNumbers(a.number, b.number));
}

function missing(meta: PageMeta, entries: Entry[]): string[] {
  const have = new Set(entries.map((e) => e.number));
  const all = meta.pages.flatMap((p) => p.numbers).filter((n) => n !== 'i');
  return all.filter((n) => !have.has(n));
}

function liveEntries(meta: PageMeta): Entry[] {
  const page = meta.currentPage < 0 ? 0 : meta.currentPage;
  return getQuestionElements(document).map((el, i) => entryFrom(el, page, true, i));
}

/** Сохранённые блоки вопросов → элементы. Один разбор HTML на все вопросы, а не по разбору на каждый. */
function rehydrateAll(htmls: string[]): (Element | null)[] {
  if (!htmls.length) return [];
  const doc = new DOMParser().parseFromString(`<body>${htmls.map((h) => `<div data-ecx-slot>${h}</div>`).join('')}</body>`, 'text/html');
  return Array.from(doc.body.children).map((wrap) => wrap.querySelector('.que'));
}

/** Быстрый подсчёт без сети — для popup. */
export async function collectQuick(): Promise<Collected> {
  const meta = parsePageMeta(document, location.href);
  let entries = liveEntries(meta);
  if (meta.mode === 'attempt' && meta.attemptId) {
    entries = await mergeStored(meta, entries);
  }
  return { meta, entries: sortEntries(entries), missingNumbers: missing(meta, entries), rightAnswersShown: hasRightAnswers(document) };
}

async function mergeStored(meta: PageMeta, live: Entry[]): Promise<Entry[]> {
  const stored = meta.attemptId ? await loadAttempt(meta.attemptId) : null;
  const byId = new Map(live.map((e) => [e.id, e]));
  const missing = Object.values(stored?.questions ?? {}).filter((q) => !byId.has(q.id));
  rehydrateAll(missing.map((q) => q.html)).forEach((el, i) => {
    const q = missing[i];
    if (el) byId.set(q.id, { id: q.id, number: q.number, slot: q.slot, page: q.page, index: q.index ?? (Number(q.number) || 0), el, live: false });
  });
  return Array.from(byId.values());
}

/** Полный сбор для выгрузки. */
export async function collectAll(opts: { fetchAttemptPages?: boolean; onProgress?: Progress } = {}): Promise<Collected> {
  const progress = opts.onProgress ?? (() => {});
  const meta = parsePageMeta(document, location.href);
  if (!meta.mode) throw new FetchError('Это не страница теста.');

  if (meta.mode === 'review') return collectReview(meta, progress);

  // attempt
  let entries = liveEntries(meta);
  void saveQuestions(
    meta,
    entries.map((e) => e.el),
    meta.currentPage,
  );
  entries = await mergeStored(meta, entries);
  if (opts.fetchAttemptPages) {
    const have = new Set(entries.map((e) => e.number));
    const todo = meta.pages.filter((p) => p.page !== meta.currentPage && p.numbers.some((n) => n !== 'i' && !have.has(n)));
    // Пользователь видит один счёт «страниц собрано из всех» — он только растёт.
    const all = meta.pages.length;
    let ready = all - todo.length;
    progress(pagesText(ready, all), ready, all);
    await inChunks(
      todo,
      parallel.attempt,
      timing.attempt,
      (p) => fetchQuizDocument(p.url),
      async (results) => {
        for (const { item: p, result: doc, error } of results) {
          if (error) {
            if (error instanceof SessionError) throw error;
            return false; // сеть/сервер: отдаём то, что успели собрать, недостающие номера будут в отчёте
          }
          // Время вышло или попытка завершена: дальше не идём, собранное сохранено.
          if (doc!.body?.id && doc!.body.id !== 'page-mod-quiz-attempt') return false;
          const els = getQuestionElements(doc!);
          await saveQuestions(meta, els, p.page);
          entries.push(...els.map((el, k) => entryFrom(el, p.page, false, k)));
          ready++;
          progress(pagesText(ready, all), ready, all);
        }
        return true;
      },
    );
  }
  const unique = Array.from(new Map(entries.map((e) => [e.id, e])).values());
  return { meta, entries: sortEntries(unique), missingNumbers: missing(meta, unique), rightAnswersShown: false };
}

async function collectReview(meta: PageMeta, progress: Progress): Promise<Collected> {
  let entries = liveEntries(meta);
  let rightAnswersShown = hasRightAnswers(document);
  const done = () => ({ meta, entries: sortEntries(entries), missingNumbers: missing(meta, entries), rightAnswersShown });

  if (meta.showAll || meta.pages.length <= 1 || missing(meta, entries).length === 0) return done();

  // 1) Все вопросы на одной странице.
  const allUrl = showAllUrl(meta);
  if (allUrl) {
    progress(pagesText(1, meta.pages.length), 1, meta.pages.length);
    try {
      const doc = await showAllDocument(allUrl);
      const els = getQuestionElements(doc);
      const fetched = els.map((el, i) => entryFrom(el, 0, false, i));
      if (fetched.length && missing(meta, fetched).length === 0) {
        entries = fetched;
        rightAnswersShown = hasRightAnswers(doc);
        return done();
      }
    } catch (e) {
      if (e instanceof SessionError) throw e;
      // иначе — обход по страницам
    }
  }

  // 2) Обход страниц по навигации. Сбой одной страницы не роняет выгрузку — её вопросы попадут в «не собраны».
  const byId = new Map(entries.map((e) => [e.id, e]));
  const todo = meta.pages.filter((p) => p.page !== meta.currentPage);
  const all = meta.pages.length;
  let n = 0;
  await inChunks(
    todo,
    parallel.review,
    timing.review,
    (p) => fetchQuizDocument(p.url),
    (results) => {
      for (const { item: p, result: doc, error } of results) {
        if (error instanceof SessionError) throw error;
        // Сбой одной страницы не роняет выгрузку — её вопросы попадут в «не собраны».
        if (doc) {
          getQuestionElements(doc).forEach((el, k) => {
            if (!byId.has(el.id)) byId.set(el.id, entryFrom(el, p.page, false, k));
          });
          rightAnswersShown ||= hasRightAnswers(doc);
        }
        n++;
        progress(pagesText(all - todo.length + n, all), all - todo.length + n, all);
      }
      return true;
    },
  );
  entries = Array.from(byId.values());
  return done();
}
