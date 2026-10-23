import { describe, expect, it } from 'vitest';
import type { Gap, Question } from '../src/parser/types';
import { crossReferences } from '../src/format/crossref';
import { formatDocument, formatQuestion } from '../src/format/txt';

const DATE = new Date(2026, 9, 23, 21, 0);
const lf = (s: string) => s.replace(/\r\n/g, '\n');

function row(label: string, options: string[], extra: Partial<Gap> = {}): Gap {
  return { kind: 'select', label, options, answer: null, correct: null, rightAnswer: null, ...extra };
}

function match(number: string, text: string, gaps: Gap[]): Question {
  return {
    id: `question-1-${number}`,
    number,
    slot: Number(number),
    qtype: 'match',
    kind: 'match',
    typeName: null,
    text,
    choices: [],
    gaps,
    otherText: null,
    attachments: [],
    hasPhoto: false,
    media: [],
    needsScreenshot: false,
    needs: [],
    result: null,
  };
}

const META = {
  quizTitle: 'Синтетический тест',
  course: '',
  url: 'https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=1',
  mode: 'attempt' as const,
  totalQuestions: 3,
};

describe('сквозные подсказки', () => {
  const opts = ['предложению', 'слову.', 'тексту'];
  const q1 = match('1', 'Вступление.', [
    row('Корень усложнён служебными морфемами, так что такое слово по смыслу равно предложению, хотя формально оно ...', ['остаётся словом.', 'теряет смысл']),
  ]);
  // Как в реальном тесте: в пункт вклеен чужой текст, но фраза с пропуском есть целиком в вопросе 1.
  const q2 = match('2', 'Другое вступление.', [
    row('Он выделял синтетические и служебными морфемами, так что такое слово по смыслу равно ..., хотя формально оно остаётся словом', opts),
    row('Пропуск без совпадений в других вопросах: ...', opts),
  ]);
  const q3 = match('3', 'Коммуникация — это не передача информации, а обмен ею между собеседниками.', [
    row('Коммуникация — это не передача информации, а ...ею между собеседниками.', ['обмен', 'поток']),
  ]);

  it('находит фразу с пропуском в тексте другого вопроса, если там стоит один из вариантов', () => {
    const hints = crossReferences([q1, q2]);
    expect(hints.get(q2.gaps[0])).toBe(
      'в вопросе 1: «Корень усложнён служебными морфемами, так что такое слово по смыслу равно предложению, хотя формально оно ...»',
    );
    expect(hints.has(q2.gaps[1])).toBe(false);
  });

  it('не ищет в самом вопросе и молчит, если слово в другом месте не из вариантов', () => {
    expect(crossReferences([q3]).size).toBe(0);
    const other = match('4', 'Коммуникация — это не передача информации, а диалог между собеседниками.', [row('Ещё пункт ...', ['x', 'y'])]);
    expect(crossReferences([q3, other]).has(q3.gaps[0])).toBe(false);
  });

  it('спорные совпадения (разные варианты) не показываются', () => {
    const a = match('5', 'Коммуникация — это не передача информации, а обмен ею.', [row('...', ['a', 'b'])]);
    const b = match('6', 'Коммуникация — это не передача информации, а поток ею.', [row('...', ['a', 'b'])]);
    expect(crossReferences([q3, a, b]).has(q3.gaps[0])).toBe(false);
    expect(crossReferences([q3, a]).get(q3.gaps[0])).toContain('в вопросе 5');
  });

  it('в выгрузке: пометка у пункта, пояснение и инструкция в шапке, «лишних» вариантов', () => {
    const txt = lf(formatDocument({ meta: META, exportedAt: DATE }, [q1, q2]));
    expect(txt).toContain('по смыслу равно ..., хотя формально оно остаётся словом → ? [в вопросе 1: «Корень');
    expect(txt).toContain('[в вопросе N: «…»] — тот же текст в другом вопросе, пропуск там виден');
    expect(txt).toContain('Не уверены или нет материала к «!» — лучший вариант с «(?)»: пустой ответ = 0 баллов.');
    expect(txt).toContain('Варианты: предложению / слову. / тексту (лишних: 1)');
  });
});

describe('скрытый правильный ответ в соответствии', () => {
  it('сужает выбор: без своего неверного и без вариантов, занятых верными пунктами', () => {
    const o = ['упрощением', 'членение', 'дерево.', 'столб', 'опрощением'];
    const q = match('7', 'Текст.', [
      row('Пункт один ...', o, { answer: 'упрощением', correct: true }),
      row('Пункт два ...', o, { answer: 'опрощением', correct: false }),
      row('Пункт три ...', o, { answer: 'членение', correct: true }),
    ]);
    q.result = { state: 'Частично правильный', grade: '0,7 из 1,0', outcome: 'partial', rightAnswer: null, feedback: null };
    expect(formatQuestion(q, { withResults: true })).toContain('- Пункт два ... → опрощением ✗ (значит, верный — один из: дерево. / столб)');
  });
});
