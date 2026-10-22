// @vitest-environment-options {"url":"https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9437135&cmid=1444264"}
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Подмена API расширения (storage.local в памяти) ───
const store: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (k: string | null) => (k == null ? { ...store } : { [k]: store[k] }),
      set: async (o: Record<string, unknown>) => {
        Object.assign(store, JSON.parse(JSON.stringify(o)));
      },
      remove: async (keys: string[]) => {
        for (const k of keys) delete store[k];
      },
    },
    onChanged: { addListener: () => {} },
  },
  runtime: { onMessage: { addListener: () => {} }, sendMessage: async () => {} },
};

type Mod = typeof import('../src/content/collect');
let collect: Mod;
beforeAll(async () => {
  collect = await import('../src/content/collect');
  collect.timing.review = 0;
  collect.timing.attempt = 0;
});

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'test/fixtures', name), 'utf8');

function setPage(html: string, url: string) {
  history.replaceState(null, '', url);
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  const bodyId = html.match(/<body[^>]*\sid=["']([^"']+)/)?.[1];
  if (bodyId) document.body.id = bodyId;
}

function respond(html: string, opts: { status?: number; url?: string } = {}) {
  return { ok: (opts.status ?? 200) < 400, status: opts.status ?? 200, url: opts.url ?? '', text: async () => html } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(store)) delete store[k];
});

// ─── review: страница 1 из 2, вопросы 3–4 на второй странице ───
const REVIEW_URL = 'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9437135&cmid=1444264';
const reviewFull = fixture('synthetic-review.html');
// Текущая страница: только вопросы 1–2.
const reviewPage0 = reviewFull.replace(/<div id="question-9868405-3"[\s\S]*?(?=<section id="mod_quiz_navblock")/, '');
// Вторая страница: только вопросы 3–4.
const reviewPage1 = reviewFull.replace(/<div id="question-9868405-1"[\s\S]*?(?=<div id="question-9868405-3")/, '');

describe('сбор review', () => {
  beforeEach(() => setPage(reviewPage0, REVIEW_URL));

  it('showall доступен — один запрос и все вопросы', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        calls.push(u);
        return respond(reviewFull);
      }),
    );
    const c = await collect.collectAll();
    expect(calls).toEqual(['https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9437135&showall=1&cmid=1444264']);
    expect(c.entries.map((e) => e.number)).toEqual(['1', '2', '3', '4']);
    expect(c.missingNumbers).toEqual([]);
    expect(c.rightAnswersShown).toBe(true);
  });

  it('showall не работает — обход по страницам навигации', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        calls.push(u);
        return /showall/.test(u) ? respond('', { status: 500 }) : respond(reviewPage1);
      }),
    );
    const c = await collect.collectAll();
    expect(calls[1]).toBe('https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9437135&cmid=1444264&page=1');
    expect(c.entries.map((e) => e.number)).toEqual(['1', '2', '3', '4']);
    expect(c.missingNumbers).toEqual([]);
  });

  it('страница не загрузилась — выгрузка не падает, номера в «не собраны»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    const c = await collect.collectAll();
    expect(c.entries.map((e) => e.number)).toEqual(['1', '2']);
    expect(c.missingNumbers).toEqual(['3', '4']);
  });

  it('порядок как на экране, даже если слоты Moodle перемешаны', async () => {
    // Вопросы показаны как 1,2,3,4, но их слоты (id) — 7,2,9,4: так бывает при перемешивании.
    const shuffled = reviewFull.replaceAll('question-9868405-1"', 'question-9868405-7"').replaceAll('question-9868405-3"', 'question-9868405-9"');
    setPage(shuffled, REVIEW_URL + '&showall=1');
    const c = await collect.collectAll();
    expect(c.entries.map((e) => e.number)).toEqual(['1', '2', '3', '4']);
  });

  it('сессия истекла — понятная ошибка', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond('<html><body id="page-login-index"></body></html>', { url: 'https://e.sfu-kras.ru/login/index.php' })),
    );
    await expect(collect.collectAll()).rejects.toThrow(/Сессия истекла/);
  });
});

// ─── attempt: накопление и обход страниц ───
const ATTEMPT_URL = 'https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=9437135&cmid=1444264&page=9';
const attemptSrc = fixture('attempt-multichoice-single.html');
const attemptPage = (n: number) =>
  attemptSrc.replaceAll('question-9868405-10', `question-9868405-${n + 1}`).replace('<span class="rui-qno">10</span>', `<span class="rui-qno">${n + 1}</span>`);

describe('сбор attempt', () => {
  beforeEach(() => setPage(attemptSrc, ATTEMPT_URL));

  it('без обхода: только текущая страница + сохранённые ранее', async () => {
    const { saveQuestions } = await import('../src/content/store');
    const { parsePageMeta, getQuestionElements } = await import('../src/parser/page');
    // «Пользователь раньше открыл страницу 3»
    const other = new DOMParser().parseFromString(attemptPage(2), 'text/html');
    await saveQuestions(parsePageMeta(document, ATTEMPT_URL), getQuestionElements(other), 2);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const c = await collect.collectAll();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(c.entries.map((e) => e.number)).toEqual(['3', '10']);
    expect(c.missingNumbers).toEqual(['1', '2', '4', '5', '6', '7', '8', '9']);
  });

  it('с обходом: 9 GET-запросов, всё собрано и сохранено', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string, init: RequestInit) => {
        calls.push(u);
        expect(init.method ?? 'GET').toBe('GET');
        const page = Number(new URL(u).searchParams.get('page') ?? 0);
        return respond(attemptPage(page));
      }),
    );
    const c = await collect.collectAll({ fetchAttemptPages: true });
    expect(calls).toHaveLength(9);
    expect(c.entries.map((e) => e.number)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(c.missingNumbers).toEqual([]);
    const saved = store['attempt:9437135'] as { questions: Record<string, unknown> };
    expect(Object.keys(saved.questions)).toHaveLength(10);
  });

  it('попытка завершилась посреди обхода — останавливаемся, собранное сохраняем', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        n++;
        if (n > 3) return respond(reviewFull.replace('page-mod-quiz-review', 'page-mod-quiz-summary'));
        return respond(attemptPage(Number(new URL(u).searchParams.get('page') ?? 0)));
      }),
    );
    const c = await collect.collectAll({ fetchAttemptPages: true });
    // Страницы грузятся пачками (parallel.attempt): пачка запрошена целиком, обработка остановилась на первой «чужой».
    expect(n).toBe(Math.ceil(4 / collect.parallel.attempt) * collect.parallel.attempt);
    expect(c.entries.map((e) => e.number)).toEqual(['1', '2', '3', '10']);
    expect(c.missingNumbers).toHaveLength(6);
  });

  it('параллельные сохранения не затирают друг друга', async () => {
    const { saveQuestions } = await import('../src/content/store');
    const { parsePageMeta, getQuestionElements } = await import('../src/parser/page');
    const meta = parsePageMeta(document, ATTEMPT_URL);
    await Promise.all([0, 1, 2, 3, 4].map((p) => saveQuestions(meta, getQuestionElements(new DOMParser().parseFromString(attemptPage(p), 'text/html')), p)));
    expect(Object.keys((store['attempt:9437135'] as { questions: object }).questions)).toHaveLength(5);
  });
});
