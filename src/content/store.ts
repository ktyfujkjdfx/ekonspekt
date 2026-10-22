import { ext } from '../shared/api';
import type { PageMeta } from '../parser/types';
import { getQuestionNumber } from '../parser/question';

/**
 * Накопление вопросов попытки в storage.local по мере того, как пользователь листает тест.
 * Ключ — id попытки. Храним HTML блока .que: из него при выгрузке строим текст и картинку.
 */

export interface StoredQuestion {
  id: string;
  number: string;
  slot: number | null;
  page: number;
  /** Позиция на странице (порядок показа). */
  index?: number;
  html: string;
}

export interface StoredAttempt {
  attemptId: string;
  quizTitle: string;
  course: string;
  url: string;
  totalQuestions: number;
  questions: Record<string, StoredQuestion>;
  updatedAt: number;
}

const PREFIX = 'attempt:';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 30;

export function serializeQue(que: Element): string {
  const clone = que.cloneNode(true) as Element;
  clone.querySelectorAll('[data-ecx]').forEach((n) => n.remove());
  // Абсолютные ссылки на картинки — чтобы их можно было отрисовать с любой страницы.
  const live = que.querySelectorAll('img');
  clone.querySelectorAll('img').forEach((img, i) => {
    const src = (live[i] as HTMLImageElement | undefined)?.src || img.getAttribute('src');
    if (src) img.setAttribute('src', src);
    img.removeAttribute('srcset');
  });
  return clone.outerHTML;
}

export async function loadAttempt(attemptId: string): Promise<StoredAttempt | null> {
  try {
    const key = PREFIX + attemptId;
    const r = await ext.storage.local.get(key);
    return (r?.[key] as StoredAttempt | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Сохранения идут строго по очереди: иначе два «прочитал → дописал → записал» затрут друг друга. */
let queue: Promise<unknown> = Promise.resolve();

export function saveQuestions(meta: PageMeta, ques: Element[], page: number): Promise<StoredAttempt | null> {
  const run = queue.then(() => saveNow(meta, ques, page));
  queue = run.catch(() => null);
  return run;
}

async function saveNow(meta: PageMeta, ques: Element[], page: number): Promise<StoredAttempt | null> {
  if (!meta.attemptId) return null;
  const prev = await loadAttempt(meta.attemptId);
  const rec: StoredAttempt = prev ?? {
    attemptId: meta.attemptId,
    quizTitle: meta.quizTitle,
    course: meta.course,
    url: meta.url,
    totalQuestions: meta.totalQuestions,
    questions: {},
    updatedAt: 0,
  };
  rec.quizTitle = meta.quizTitle || rec.quizTitle;
  rec.course = meta.course || rec.course;
  rec.totalQuestions = meta.totalQuestions || rec.totalQuestions;
  for (const [index, que] of ques.entries()) {
    if (!que.id) continue;
    const slotMatch = que.id.match(/-(\d+)$/);
    rec.questions[que.id] = {
      id: que.id,
      number: getQuestionNumber(que),
      slot: slotMatch ? Number(slotMatch[1]) : null,
      page,
      index,
      html: serializeQue(que),
    };
  }
  rec.updatedAt = Date.now();
  try {
    await ext.storage.local.set({ [PREFIX + meta.attemptId]: rec });
  } catch (e) {
    console.warn('[еКонспект] не удалось сохранить вопросы', e);
  }
  // Уборка читает всё хранилище — достаточно одного раза за открытие страницы, а не после каждого сохранения.
  if (!cleaned) {
    cleaned = true;
    void cleanup();
  }
  return rec;
}

/** Удаляем старые попытки, чтобы не копить мусор. */
let cleaned = false;

async function cleanup(): Promise<void> {
  try {
    const all = await ext.storage.local.get(null);
    const attempts = Object.entries(all)
      .filter(([k]) => k.startsWith(PREFIX))
      .map(([k, v]) => [k, (v as StoredAttempt).updatedAt || 0] as const)
      .sort((a, b) => b[1] - a[1]);
    const now = Date.now();
    const stale = attempts.filter(([, t], i) => i >= MAX_ATTEMPTS || now - t > MAX_AGE_MS).map(([k]) => k);
    if (stale.length) await ext.storage.local.remove(stale);
  } catch {
    /* не критично */
  }
}
