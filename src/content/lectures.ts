import type { PageMeta, Question } from '../parser/types';
import { formatLessonAsMaterial } from '../format/lesson';
import { loadLessonIndex, loadLessons, orderedPages, type LessonSummary } from './lessonStore';

/**
 * Лекции, собранные расширением, — материал к тесту: та же тема (раздел курса) или лекция,
 * на которую ссылается вопрос («из Lesson 2»). Нейросеть отвечает по курсу, а не по общим знаниям.
 */

/** Предел на весь материал, чтобы файл не раздувался (≈ 15–20 тыс. токенов). */
const MAX_CHARS = 60000;

function sameCourse(l: Pick<LessonSummary, 'course'>, meta: Pick<PageMeta, 'course'>): boolean {
  return !!l.course && l.course.trim().toLowerCase() === meta.course.trim().toLowerCase();
}

export function relevantLessons<T extends Omit<LessonSummary, 'cmid'>>(
  all: T[],
  meta: Pick<PageMeta, 'course' | 'sectionId'>,
  questions: Question[] = [],
): T[] {
  const refs = questions.flatMap((q) => q.needs.filter((n) => n.kind === 'lesson').map((n) => n.label.toLowerCase()));
  return all
    .filter((l) => sameCourse(l, meta) && l.content > 0)
    .filter((l) => (meta.sectionId && l.sectionId === meta.sectionId) || refs.some((r) => l.title.toLowerCase().includes(r)))
    .sort((a, b) => Number(b.sectionId === meta.sectionId) - Number(a.sectionId === meta.sectionId) || a.updatedAt - b.updatedAt);
}

export async function countLectures(meta: Pick<PageMeta, 'course' | 'sectionId'>): Promise<number> {
  return relevantLessons(await loadLessonIndex(), meta).length;
}

/** Блоки «## Лекция …» для конца файла теста и сколько лекций не вошло из-за объёма. */
export async function lecturesForQuiz(
  meta: Pick<PageMeta, 'course' | 'sectionId'>,
  questions: Question[],
): Promise<{ blocks: string[]; titles: string[]; skipped: number }> {
  const lessons = await loadLessons(relevantLessons(await loadLessonIndex(), meta, questions).map((l) => l.cmid));
  const blocks: string[] = [];
  const titles: string[] = [];
  let size = 0;
  let skipped = 0;
  for (const l of lessons) {
    const block = formatLessonAsMaterial(l.title, orderedPages(l));
    if (!block) continue;
    if (size + block.length > MAX_CHARS && blocks.length) {
      skipped++;
      continue;
    }
    blocks.push(block);
    titles.push(l.title);
    size += block.length;
  }
  return { blocks, titles, skipped };
}
