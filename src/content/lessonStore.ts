import { ext } from '../shared/api';
import type { LessonMeta, LessonPage } from '../parser/lesson';

/**
 * Лекции, которые студент листал: разобранные страницы (текст, варианты, ссылки на рисунки) в storage.local.
 * Храним не HTML, а готовую структуру — страница занимает единицы килобайт, лекций помещается много.
 */

export interface StoredLesson {
  cmid: string;
  title: string;
  course: string;
  section: string;
  sectionId: string | null;
  url: string;
  progress: number | null;
  finished: boolean;
  /** Оценка за вопросы с финальной страницы. */
  score: number | null;
  max: number | null;
  menu: { pageid: string; title: string }[];
  pages: Record<string, LessonPage>;
  /** id страницы вопроса, которую студент сейчас отправляет (для отзыва на continue.php). */
  pending: string | null;
  /** id страниц, на которые ведут кнопки и ссылки, — кандидаты для «Собрать всю лекцию». */
  known?: string[];
  /** id, которые уже проверены и к этой лекции не относятся. */
  absent?: string[];
  nextSeq: number;
  updatedAt: number;
  /** Когда последний раз завершился «Собрать всю лекцию». */
  collectedAt?: number;
}

const PREFIX = 'lesson:';
const MAX_LESSONS = 60;
/**
 * Краткий индекс лекций (курс, тема, название). По нему окно расширения и выгрузка теста находят
 * лекции темы, не читая всё хранилище, где лежат и полные страницы попыток.
 */
const INDEX = 'lessonIndex';

export interface LessonSummary {
  cmid: string;
  title: string;
  course: string;
  sectionId: string | null;
  content: number;
  updatedAt: number;
}

function summaryOf(rec: StoredLesson): LessonSummary {
  return {
    cmid: rec.cmid,
    title: rec.title,
    course: rec.course,
    sectionId: rec.sectionId,
    content: Object.values(rec.pages).filter((p) => p.kind === 'content').length,
    updatedAt: rec.updatedAt,
  };
}

export async function loadLessonIndex(): Promise<LessonSummary[]> {
  try {
    const r = await ext.storage.local.get(INDEX);
    const idx = r?.[INDEX] as Record<string, LessonSummary> | undefined;
    if (idx) return Object.values(idx);
    // Лекции, сохранённые до появления индекса: один раз строим его из хранилища.
    const all = await ext.storage.local.get(null);
    const built: Record<string, LessonSummary> = {};
    for (const [k, v] of Object.entries(all)) if (k.startsWith(PREFIX)) built[(v as StoredLesson).cmid] = summaryOf(v as StoredLesson);
    await ext.storage.local.set({ [INDEX]: built });
    return Object.values(built);
  } catch {
    return [];
  }
}

/** Несколько лекций одним чтением. */
export async function loadLessons(cmids: string[]): Promise<StoredLesson[]> {
  if (!cmids.length) return [];
  try {
    const r = await ext.storage.local.get(cmids.map((c) => PREFIX + c));
    return cmids.map((c) => r?.[PREFIX + c] as StoredLesson | undefined).filter((x): x is StoredLesson => !!x);
  } catch {
    return [];
  }
}

export async function loadLesson(cmid: string): Promise<StoredLesson | null> {
  try {
    const k = PREFIX + cmid;
    const r = await ext.storage.local.get(k);
    return (r?.[k] as StoredLesson | undefined) ?? null;
  } catch {
    return null;
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Изменения строго по очереди: «прочитал → дописал → записал» не затирают друг друга. */
export function updateLesson(meta: LessonMeta, fn: (rec: StoredLesson) => void): Promise<StoredLesson | null> {
  const run = queue.then(async () => {
    if (!meta.cmid) return null;
    const rec: StoredLesson = (await loadLesson(meta.cmid)) ?? {
      cmid: meta.cmid,
      title: meta.title,
      course: meta.course,
      section: meta.section,
      sectionId: meta.sectionId,
      url: meta.url,
      progress: null,
      finished: false,
      score: null,
      max: null,
      menu: [],
      pages: {},
      pending: null,
      nextSeq: 1,
      updatedAt: 0,
    };
    rec.title = meta.title || rec.title;
    rec.course = meta.course || rec.course;
    rec.section = meta.section || rec.section;
    rec.sectionId = meta.sectionId || rec.sectionId;
    if (meta.progress != null) rec.progress = Math.max(rec.progress ?? 0, meta.progress);
    if (meta.menu.length) rec.menu = meta.menu;
    fn(rec);
    rec.updatedAt = Date.now();
    // Лекция и строка индекса — одной записью; лишние лекции убираем по индексу, не читая всё хранилище.
    const idxRaw = (await ext.storage.local.get(INDEX))?.[INDEX] as Record<string, LessonSummary> | undefined;
    const idx = { ...(idxRaw ?? {}), [rec.cmid]: summaryOf(rec) };
    const old = Object.values(idx)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(MAX_LESSONS)
      .map((s) => s.cmid);
    old.forEach((c) => delete idx[c]);
    await ext.storage.local.set({ [PREFIX + meta.cmid]: rec, [INDEX]: idx });
    if (old.length) await ext.storage.local.remove(old.map((c) => PREFIX + c));
    return rec;
  });
  queue = run.catch((e) => {
    console.warn('[еКонспект] не удалось сохранить лекцию', e);
    return null;
  });
  return queue as Promise<StoredLesson | null>;
}

/**
 * Открытая студентом страница. Порядок — по первому открытию: так её показал сайт. Страница, которую раньше
 * нашёл сбор, при открытии получает настоящее место (её место по номеру id было лишь догадкой).
 */
export function rememberPage(rec: StoredLesson, page: LessonPage): void {
  if (!page.pageid) return;
  const prev = rec.pages[page.pageid];
  rec.pages[page.pageid] = {
    ...page,
    seq: prev && !prev.fetched && prev.seq != null ? prev.seq : rec.nextSeq++,
    answer: page.answer ?? prev?.answer ?? null,
    correct: page.correct ?? prev?.correct ?? null,
  };
}

/**
 * Страница, прочитанная расширением. Место считается при выгрузке (orderedPages). Если страница уже есть,
 * берём только ответ: в «Пересмотре лекции» Moodle показывает на странице вопроса отмеченный студентом ответ.
 */
export function rememberFetchedPage(rec: StoredLesson, page: LessonPage): void {
  if (!page.pageid) return;
  const prev = rec.pages[page.pageid];
  if (prev) {
    if (!prev.answer && page.answer) prev.answer = page.answer;
    return;
  }
  rec.pages[page.pageid] = { ...page, seq: undefined, correct: null, fetched: true };
}

/**
 * Порядок как на сайте: открытые студентом страницы — в порядке открытия; найденные сбором — сразу за
 * открытой страницей с ближайшим меньшим id (страницы лекции обычно создаются подряд). seq в ответе — номер по порядку.
 */
export function orderedPages(rec: StoredLesson): LessonPage[] {
  const all = Object.values(rec.pages);
  const out = all.filter((p) => !p.fetched).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const found = all.filter((p) => p.fetched).sort((a, b) => Number(a.pageid) - Number(b.pageid));
  for (const f of found) {
    const id = Number(f.pageid);
    let at = 0;
    let best = -Infinity;
    out.forEach((p, i) => {
      const n = Number(p.pageid);
      if (!p.fetched && n < id && n > best) {
        best = n;
        at = i + 1;
      }
    });
    while (at < out.length && out[at].fetched && Number(out[at].pageid) < id) at++;
    out.splice(at, 0, f);
  }
  // Подсказки сайта точнее номеров id: меню лекции идёт в порядке страниц, а номера в названиях —
  // в порядке вопросов. Переставляем только найденные сбором страницы, на их же местах.
  const menuIndex = new Map((rec.menu ?? []).map((m, i) => [m.pageid, i]));
  reorderInPlace(out, (p) => (p.fetched && menuIndex.has(p.pageid) ? menuIndex.get(p.pageid)! : null));
  reorderInPlace(out, (p) => (p.fetched && p.kind === 'question' ? titleNumber(p.title) : null), 3);
  return out.map((p, i) => ({ ...p, seq: i + 1 }));
}

/** «Вопрос 7», «Задание 3.», «Q12», «7. …» → 7. */
export function titleNumber(title: string): number | null {
  const m = title.trim().match(/^(?:(?:вопрос|задание|задача|тест|упражнение|question|task|q)\s*№?\s*)?(\d{1,3})(?:[.):\s]|$)/i);
  return m ? Number(m[1]) : null;
}

/** Страницы с ключом встают по возрастанию ключа на те же позиции; ключи должны быть разными. */
function reorderInPlace(pages: LessonPage[], key: (p: LessonPage) => number | null, min = 2): void {
  const slots: number[] = [];
  const keyed: { p: LessonPage; k: number }[] = [];
  pages.forEach((p, i) => {
    const k = key(p);
    if (k == null) return;
    slots.push(i);
    keyed.push({ p, k });
  });
  if (keyed.length < min || new Set(keyed.map((x) => x.k)).size !== keyed.length) return;
  keyed.sort((a, b) => a.k - b.k).forEach((x, j) => (pages[slots[j]] = x.p));
}

/** Порядок части страниц — догадка по номерам id: студент открывал не все страницы сам. */
export function orderIsApproximate(rec: StoredLesson): boolean {
  const pages = Object.values(rec.pages);
  return pages.some((p) => p.fetched) && pages.length > 1;
}
