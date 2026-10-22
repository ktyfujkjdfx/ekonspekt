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

/** Страница запоминается один раз (порядок — по первому открытию); повторный показ лишь уточняет её. */
export function rememberPage(rec: StoredLesson, page: LessonPage): void {
  if (!page.pageid) return;
  const prev = rec.pages[page.pageid];
  rec.pages[page.pageid] = {
    ...page,
    seq: prev?.seq ?? rec.nextSeq++,
    answer: page.answer ?? prev?.answer ?? null,
    correct: page.correct ?? prev?.correct ?? null,
  };
}

/**
 * Страница, прочитанная расширением: встаёт между открытыми по номеру id
 * (страницы лекции создаются подряд, и их id идут в порядке чтения).
 */
export function rememberFetchedPage(rec: StoredLesson, page: LessonPage): void {
  if (!page.pageid || rec.pages[page.pageid]) return;
  const id = Number(page.pageid);
  const others = Object.values(rec.pages)
    .filter((p) => p.seq != null)
    .sort((a, b) => Number(a.pageid) - Number(b.pageid));
  const prev = [...others].reverse().find((p) => Number(p.pageid) < id);
  const next = others.find((p) => Number(p.pageid) > id);
  let seq: number;
  if (prev && next) seq = prev.seq! + ((next.seq! - prev.seq!) * (id - Number(prev.pageid))) / (Number(next.pageid) - Number(prev.pageid));
  else if (prev) seq = prev.seq! + (id - Number(prev.pageid)) / 1000;
  else if (next) seq = next.seq! - (Number(next.pageid) - id) / 1000;
  else seq = rec.nextSeq++;
  rec.pages[page.pageid] = { ...page, seq, fetched: true };
}

/** Страницы в том порядке, в каком студент их открывал. */
export function orderedPages(rec: StoredLesson): LessonPage[] {
  return Object.values(rec.pages).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}
