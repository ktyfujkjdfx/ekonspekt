import { ext } from '../shared/api';
import type { PageMeta, Question } from '../parser/types';
import { appendix, factFromQuestion, knownFor, knownLine, mergeFact, normalize, type Fact } from '../format/known';

/**
 * Ответы, подтверждённые сайтом в просмотре результатов, — в storage.local, по курсу.
 * Хранятся только на этом компьютере; при следующей выгрузке подставляются к тем же вопросам.
 */

interface CourseFacts {
  course: string;
  facts: Record<string, Fact>;
  updatedAt: number;
}

const PREFIX = 'known:';
const MAX_FACTS = 600;
const MAX_COURSES = 25;

const keyOf = (course: string) => PREFIX + course.trim().toLowerCase();

async function load(course: string): Promise<CourseFacts | null> {
  try {
    const k = keyOf(course);
    const r = await ext.storage.local.get(k);
    return (r?.[k] as CourseFacts | undefined) ?? null;
  } catch {
    return null;
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Запоминаем отметки «верно / неверно» из просмотра результатов. Вопросы — разобранные с результатами. */
export function rememberResults(meta: PageMeta, questions: Question[]): Promise<void> {
  const run = queue
    .then(async () => {
      if (meta.mode !== 'review' || !meta.course) return;
      const now = Date.now();
      const fresh = questions.map((q) => factFromQuestion(q, meta.attemptId, meta.cmid, now)).filter((f): f is Fact => !!f);
      if (!fresh.length) return;
      const rec = (await load(meta.course)) ?? { course: meta.course, facts: {}, updatedAt: 0 };
      for (const f of fresh) rec.facts[f.key] = mergeFact(rec.facts[f.key], f);
      const all = Object.values(rec.facts);
      if (all.length > MAX_FACTS) {
        all.sort((a, b) => b.at - a.at);
        rec.facts = Object.fromEntries(all.slice(0, MAX_FACTS).map((f) => [f.key, f]));
      }
      rec.updatedAt = now;
      await ext.storage.local.set({ [keyOf(meta.course)]: rec });
      if (!pruned) {
        pruned = true;
        void prune();
      }
    })
    .catch((e) => console.warn('[еКонспект] не удалось запомнить ответы', e));
  queue = run;
  return run;
}

/** Готовые отметки (например, из лекции) — в ту же базу курса. */
export function rememberFacts(course: string, facts: Fact[]): Promise<void> {
  const run = queue
    .then(async () => {
      if (!course || !facts.length) return;
      const rec = (await load(course)) ?? { course, facts: {}, updatedAt: 0 };
      for (const f of facts) rec.facts[f.key] = mergeFact(rec.facts[f.key], f);
      rec.updatedAt = Date.now();
      await ext.storage.local.set({ [keyOf(course)]: rec });
    })
    .catch((e) => console.warn('[еКонспект] не удалось запомнить ответы', e));
  queue = run;
  return run;
}

/** Строки «= Проверено…» к вопросам и справка в конце файла. */
export async function knownForExport(meta: PageMeta, questions: Question[]): Promise<{ known: Map<string, string>; appendix: string[] }> {
  const known = new Map<string, string>();
  const rec = meta.course ? await load(meta.course) : null;
  if (!rec) return { known, appendix: [] };
  const facts = new Map(Object.entries(rec.facts));
  const used = new Set<string>();
  for (const q of questions) {
    const f = knownFor(q, facts, meta.attemptId);
    if (!f) continue;
    used.add(f.key);
    const line = knownLine(q, f);
    if (line) known.set(q.id, line);
  }
  // Вопросы этого файла в справку не повторяем, даже если отметки взяты из этой же попытки.
  for (const q of questions) used.add(questionKey(q));
  return { known, appendix: appendix(Object.values(rec.facts), used, meta.cmid) };
}

const questionKey = (q: Question) => normalize(q.text);

/** Уборка читает всё хранилище — один раз за открытие страницы. */
let pruned = false;

async function prune(): Promise<void> {
  try {
    const all = await ext.storage.local.get(null);
    const courses = Object.entries(all)
      .filter(([k]) => k.startsWith(PREFIX))
      .sort((a, b) => ((b[1] as CourseFacts).updatedAt || 0) - ((a[1] as CourseFacts).updatedAt || 0));
    const extra = courses.slice(MAX_COURSES).map(([k]) => k);
    if (extra.length) await ext.storage.local.remove(extra);
  } catch {
    /* не критично */
  }
}
