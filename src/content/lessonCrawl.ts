import { explicitPageIds, parseLessonMeta, parseLessonPage, type LessonMeta, type LessonPage } from '../parser/lesson';
import { pageFetch, readHtmlUntil, SessionError, FetchError, sleep } from './fetchPages';
import { loadLesson, rememberFetchedPage, updateLesson } from './lessonStore';

/**
 * «Собрать всю лекцию»: страницы, которые студент не открывал (или открывал до установки расширения).
 *
 * Как это безопасно:
 * — только GET view.php?id=…&pageid=N — то же, что открыть ссылку на страницу; continue.php (ответы,
 *   переходы «Далее») не трогаем никогда;
 * — финальную страницу (pageid=-9, она выставляет оценку) и любые id ≤ 0 не открываем;
 * — переадресации не выполняем: служебные страницы лекции перенаправляют, и туда мы не идём.
 *
 * Как находим страницы: «Далее» ведёт на «следующую» без номера, поэтому номера берём из кнопок-ответвлений
 * и ссылок, а остальное — по соседним id: страницы лекции создаются подряд, их id идут почти без пропусков.
 *
 * Быстро:
 * — страницы проверяются пачками параллельно (время ≈ число пачек × один ответ сервера), без пауз;
 * — страница качается только до конца основного блока (~27 % объёма, остальное — скрипты и меню сайта);
 * — «не наша» страница отсеивается поиском по тексту, без разбора HTML;
 * — проверка «сайт отдаёт страницы по ссылке» делается, только если ничего не нашлось;
 * — запись в хранилище — одна на пачку.
 */

export const crawlTiming = { pause: 0 };
/** Параллельных запросов: быстро для студента и в пределах обычной вкладки для сервера. */
export const CONCURRENCY = 8;
/** Конец основного блока страницы лекции: дальше страницу не качаем. */
const CONTENT_END = 'activity-navigation';
/** Сколько подряд «чужих» id проверить за краем, прежде чем решить, что лекция кончилась. */
export const EDGE = 6;
const MAX_REQUESTS = 120;

export interface CrawlState {
  have: Set<number>;
  tried: Set<number>;
  explicit: number[];
}

/** Сколько id за верхним и нижним краем уже проверено впустую (выводится из состояния, без счётчиков). */
export function edgeMisses(s: CrawlState): { up: number; down: number } {
  if (!s.have.size) return { up: EDGE, down: EDGE };
  let max = -Infinity;
  let min = Infinity;
  for (const id of s.have) {
    if (id > max) max = id;
    if (id < min) min = id;
  }
  let up = 0;
  let down = 0;
  for (const t of s.tried) {
    if (t > max && t <= max + EDGE) up++;
    else if (t < min && t >= min - EDGE) down++;
  }
  return { up, down };
}

/**
 * Следующая пачка id для параллельной проверки. Чистая функция — проверяется тестами.
 * Порядок: явные ссылки → пропуски между известными → края (вверх и вниз поровну).
 */
export function planBatch(s: CrawlState, size = CONCURRENCY): number[] {
  const out: number[] = [];
  const ok = (id: number) => id > 0 && !s.have.has(id) && !s.tried.has(id) && !out.includes(id);
  const push = (id: number) => {
    if (out.length < size && ok(id)) out.push(id);
  };
  for (const id of s.explicit) push(id);
  if (!s.have.size) return out;
  const ids = Array.from(s.have).sort((a, b) => a - b);
  const min = ids[0];
  const max = ids[ids.length - 1];
  for (let id = min + 1; id < max && out.length < size; id++) push(id);
  // Край: проверяем не дальше EDGE от последней найденной страницы; найденная страница сдвигает край.
  const up: number[] = [];
  const down: number[] = [];
  for (let id = max + 1; id <= max + EDGE; id++) if (ok(id)) up.push(id);
  for (let id = min - 1; id >= Math.max(1, min - EDGE); id--) if (ok(id)) down.push(id);
  for (let i = 0; out.length < size && (i < up.length || i < down.length); i++) {
    if (i < up.length) push(up[i]);
    if (i < down.length) push(down[i]);
  }
  return out;
}

/** Совместимость с прежним пошаговым API: первый id следующей пачки. */
export function nextProbe(s: CrawlState): number | null {
  return planBatch(s, 1)[0] ?? null;
}

type Fetched = { kind: 'page'; doc: Document; url: string } | { kind: 'miss' };

/** Быстрый отсев без разбора HTML: на своей странице есть форма с этим pageid. */
export function looksLikePage(html: string, id: number): boolean {
  return html.includes('page-mod-lesson') && new RegExp(`name="pageid"[^>]*value="${id}"`).test(html);
}

async function getPage(url: string, id?: number): Promise<Fetched> {
  let res: Response;
  try {
    res = await pageFetch(url, { credentials: 'include', redirect: 'manual', cache: 'no-store' });
  } catch {
    throw new FetchError('Нет связи с сайтом курсов. Проверьте интернет и попробуйте ещё раз.');
  }
  // Переадресация (служебная страница, чужая лекция, вход на сайт) — не идём туда.
  if (res.type === 'opaqueredirect' || res.status >= 300) return { kind: 'miss' };
  const html = await readHtmlUntil(res, CONTENT_END);
  if (/id=["']page-login-index["']/.test(html)) throw new SessionError('Сессия истекла: войдите на сайт курсов заново и повторите.');
  if (id != null && !looksLikePage(html, id)) return { kind: 'miss' };
  return { kind: 'page', doc: new DOMParser().parseFromString(html, 'text/html'), url };
}

interface Hit {
  id: number;
  page: LessonPage;
  links: string[];
}

async function probe(id: number, meta: LessonMeta, url: string): Promise<Hit | null> {
  const got = await getPage(url, id);
  if (got.kind !== 'page') return null;
  const meta2 = parseLessonMeta(got.doc, url);
  const page = parseLessonPage(got.doc, url, meta2);
  // Своя страница: та же лекция и тот же номер (служебные страницы показывают другую).
  const ours = page && meta2.cmid === meta.cmid && page.pageid === String(id) && (page.kind === 'content' || page.kind === 'question');
  return ours ? { id, page: page!, links: explicitPageIds(got.doc, meta.cmid) } : null;
}

export async function collectLesson(meta: LessonMeta, progress: (t: string, d?: number, n?: number) => void): Promise<string> {
  if (!meta.cmid) throw new Error('Не удалось определить лекцию на этой странице.');
  const origin = new URL(meta.url).origin;
  const pageUrl = (id: number) => `${origin}/mod/lesson/view.php?id=${meta.cmid}&pageid=${id}`;

  const rec = await loadLesson(meta.cmid);
  const have = new Set(
    Object.keys(rec?.pages ?? {})
      .map(Number)
      .filter((n) => n > 0),
  );
  const current = Number(meta.pageid) > 0 ? Number(meta.pageid) : null;
  if (current) have.add(current);
  if (!have.size) throw new Error('Откройте любую страницу лекции — от неё расширение найдёт остальные.');
  const before = Object.keys(rec?.pages ?? {}).length;
  const state: CrawlState = {
    have,
    tried: new Set((rec?.absent ?? []).map(Number)),
    explicit: (rec?.known ?? []).map(Number).filter((n) => n > 0),
  };

  const absent: string[] = [];
  const found: string[] = [];
  let requests = 0;
  let answers = 0;
  progress('Читаю лекцию…', 0, 100);

  // Лекция пройдена: в «Пересмотре лекции» сайт показывает на странице вопроса ваш ответ — дочитываем его
  // в уже собранных вопросах (тот же GET view.php, ничего не отправляем).
  const unanswered = rec?.finished
    ? Object.values(rec.pages)
        .filter((p) => p.kind === 'question' && !p.answer && Number(p.pageid) > 0)
        .map((p) => Number(p.pageid))
    : [];
  for (let i = 0; i < unanswered.length && requests < MAX_REQUESTS; i += CONCURRENCY) {
    const batch = unanswered.slice(i, i + CONCURRENCY);
    requests += batch.length;
    progress('Читаю ваши ответы…', i, unanswered.length + EDGE * 2);
    const hits = (await Promise.all(batch.map((id) => probe(id, meta, pageUrl(id))))).filter((r): r is Hit => !!r && !!r.page.answer);
    answers += hits.length;
    if (hits.length) await updateLesson(meta, (r) => hits.forEach((h) => rememberFetchedPage(r, h.page)));
  }

  for (let batch = planBatch(state); batch.length && requests < MAX_REQUESTS; batch = planBatch(state)) {
    batch.forEach((id) => state.tried.add(id));
    requests += batch.length;
    const results = await Promise.all(batch.map((id) => probe(id, meta, pageUrl(id))));

    const hits = results.filter((r): r is Hit => !!r);
    answers += hits.filter((h) => h.page.kind === 'question' && h.page.answer).length;
    batch.filter((id) => !hits.some((h) => h.id === id)).forEach((id) => absent.push(String(id)));
    for (const h of hits) {
      state.have.add(h.id);
      found.push(String(h.id));
      for (const l of h.links) if (!state.explicit.includes(Number(l))) state.explicit.push(Number(l));
    }
    if (hits.length) {
      // Одна запись в хранилище на пачку.
      await updateLesson(meta, (r) => {
        for (const h of hits) rememberFetchedPage(r, h.page);
        r.known = Array.from(new Set([...(r.known ?? []), ...state.explicit.map(String)]));
      });
    }
    const m = edgeMisses(state);
    const left = EDGE - Math.min(EDGE, m.up) + (EDGE - Math.min(EDGE, m.down));
    progress(`Читаю лекцию: найдено страниц ${state.have.size}`, requests, requests + left);
    if (crawlTiming.pause) await sleep(crawlTiming.pause);
  }

  // Ничего не нашлось — проверим, отдаёт ли сайт хотя бы известную страницу по ссылке, чтобы честно объяснить почему.
  if (!found.length && !answers) {
    const checkId = current ?? Math.min(...have);
    const g = await getPage(pageUrl(checkId), checkId);
    if (g.kind !== 'page' || !parseLessonPage(g.doc, pageUrl(checkId))) {
      throw new Error('Сайт не открывает страницы этой лекции по прямой ссылке. Листайте её как обычно: каждая открытая страница уже сохраняется.');
    }
  }
  await updateLesson(meta, (r) => {
    r.absent = Array.from(new Set([...(r.absent ?? []), ...absent])).slice(-400);
    r.collectedAt = Date.now();
  });
  const after = before + found.length;
  const withAnswers = answers ? `; ваших ответов: ${answers}` : '';
  return found.length
    ? `Готово: найдено ещё ${found.length} ${found.length === 1 ? 'страница' : found.length < 5 ? 'страницы' : 'страниц'}, в конспекте ${after}${withAnswers}`
    : `Новых страниц нет: в конспекте все ${after}${withAnswers}`;
}
