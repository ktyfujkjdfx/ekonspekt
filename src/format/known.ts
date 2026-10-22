import type { Question } from '../parser/types';

/**
 * Ответы, проверенные в прошлых попытках этого курса.
 * Из просмотра результатов берём только то, что сайт подтвердил: «верно» или «неверно».
 * При следующей выгрузке это подставляется к тем же вопросам (варианты могут быть перемешаны,
 * поэтому сравниваем тексты, а не буквы), а остальное идёт справкой в конце файла.
 */
export interface Fact {
  /** Нормализованный текст вопроса — ключ. */
  key: string;
  /** Текст вопроса (сокращённый) для справки. */
  q: string;
  right: string[];
  wrong: string[];
  /** Попытки, из которых взяты отметки. */
  attempts: string[];
  cmid: string | null;
  at: number;
}

const MAX_Q = 220;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_^]/g, '')
    .replace(/[«»"'“”„`]/g, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[\s.,;:!?…-]+$/g, '')
    .trim();
}

const short = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_Q ? one.slice(0, MAX_Q - 1).trimEnd() + '…' : one;
};

function add(list: string[], v: string) {
  const t = v.replace(/\s+/g, ' ').trim();
  if (t && !list.some((x) => normalize(x) === normalize(t))) list.push(t);
}

/** Подтверждённые сайтом отметки по вопросу из просмотра результатов (разобранного с результатами). */
export function factFromQuestion(q: Question, attemptId: string | null, cmid: string | null, now = Date.now()): Fact | null {
  if (q.kind === 'info' || !q.result || !q.text.trim()) return null;
  const right: string[] = [];
  const wrong: string[] = [];
  const single = q.kind === 'single';

  for (const c of q.choices) {
    if (!c.text) continue;
    if (c.correct === true) add(right, c.text);
    else if (c.checked && c.correct === false) add(wrong, c.text);
  }
  // Один ответ без отметки у варианта: итог вопроса говорит сам за себя.
  if (single && !q.choices.some((c) => c.correct !== null)) {
    const mine = q.choices.find((c) => c.checked);
    if (mine?.text && q.result.outcome === 'correct') add(right, mine.text);
    if (mine?.text && q.result.outcome === 'incorrect') add(wrong, mine.text);
  }

  for (const g of q.gaps) {
    const prefix = g.label === 'Ответ' ? '' : `${g.label.replace(/\s+/g, ' ')} → `;
    if (g.rightAnswer) add(right, prefix + g.rightAnswer);
    if (g.answer && g.kind !== 'essay') {
      if (g.correct === true) add(right, prefix + g.answer);
      else if (g.correct === false) add(wrong, prefix + g.answer);
    }
  }
  if (q.result.rightAnswer && !right.length) add(right, q.result.rightAnswer);

  if (!right.length && !wrong.length) return null;
  return { key: normalize(q.text), q: short(q.text), right, wrong, attempts: attemptId ? [attemptId] : [], cmid, at: now };
}

/** Объединение с уже известным: новые отметки дописываются, противоречия решает свежая. */
export function mergeFact(prev: Fact | undefined, next: Fact): Fact {
  if (!prev) return next;
  const right = [...next.right];
  const wrong = [...next.wrong];
  for (const r of prev.right) if (!wrong.some((w) => normalize(w) === normalize(r))) add(right, r);
  for (const w of prev.wrong) if (!right.some((r) => normalize(r) === normalize(w))) add(wrong, w);
  const attempts = [...prev.attempts];
  for (const a of next.attempts) if (!attempts.includes(a)) attempts.push(a);
  return { ...next, right, wrong, attempts: attempts.slice(-10), cmid: next.cmid ?? prev.cmid };
}

/** Отметки, которые относятся к этому вопросу и пришли не из этой же попытки. */
export function knownFor(q: Question, facts: Map<string, Fact>, currentAttempt: string | null): Fact | null {
  if (q.kind === 'info') return null;
  const f = facts.get(normalize(q.text));
  if (!f) return null;
  if (currentAttempt && f.attempts.length && f.attempts.every((a) => a === currentAttempt)) return null;
  return f;
}

const quote = (s: string) => `«${s}»`;

/**
 * Строка к вопросу. Для вариантов указываем букву в этой попытке — порядок мог измениться.
 */
export function knownLine(q: Question, f: Fact): string | null {
  const letter = (text: string) => {
    const c = q.choices.find((x) => normalize(x.text) === normalize(text));
    return c ? `${c.label}) ` : '';
  };
  const hasChoices = q.choices.length > 0;
  const fit = (list: string[]) => (hasChoices ? list.filter((t) => letter(t)) : list);
  const right = fit(f.right);
  const wrong = fit(f.wrong);
  if (!right.length && !wrong.length) return null;
  const parts: string[] = [];
  if (right.length) parts.push(`верно — ${right.map((t) => letter(t) + quote(t)).join('; ')}`);
  if (wrong.length) parts.push(`неверно — ${wrong.map((t) => letter(t) + quote(t)).join('; ')}`);
  return `= Проверено в прошлой попытке: ${parts.join('; ')}.`;
}

/** Справка в конце файла: подтверждённые ответы курса, которых нет среди вопросов файла. */
export function appendix(facts: Fact[], used: Set<string>, cmid: string | null, limit = 60): string[] {
  // Ответы пропусков («[3] → is») без своего вопроса ничего не говорят — в справку не берём.
  const selfContained = (f: Fact) => f.right.some((r) => !/^\[\d+\] → /.test(r));
  const rest = facts
    .filter((f) => !used.has(f.key) && selfContained(f))
    .sort((a, b) => Number(b.cmid === cmid) - Number(a.cmid === cmid) || b.at - a.at)
    .slice(0, limit);
  if (!rest.length) return [];
  return [
    'Справка: ответы, подтверждённые в прошлых попытках этого курса',
    ...rest.map((f) => `- ${f.q} → ${short(f.right.filter((r) => !/^\[\d+\] → /.test(r)).join('; '))}`),
  ];
}

/** Вопрос лекции с ответом, который сайт подтвердил (отзыв «верно/неверно» или полный балл за лекцию). */
export function factFromLessonPage(
  p: { kind: string; text: string; answer?: string | null; correct?: boolean | null; qtype?: string },
  cmid: string,
  now = Date.now(),
): Fact | null {
  if (p.kind !== 'question' || !p.answer || p.correct == null || p.qtype === 'essay' || !p.text.trim()) return null;
  const answers = p.answer
    .split('; ')
    .map((a) => a.trim())
    .filter(Boolean);
  return {
    key: normalize(p.text),
    q: short(p.text),
    right: p.correct ? answers : [],
    wrong: p.correct ? [] : answers.length === 1 ? answers : [],
    attempts: [`lesson:${cmid}`],
    cmid: null,
    at: now,
  };
}
