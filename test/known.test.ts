import { describe, expect, it } from 'vitest';
import type { Choice, Question } from '../src/parser/types';
import { appendix, factFromQuestion, knownFor, knownLine, mergeFact, normalize } from '../src/format/known';
import { formatDocument, formatQuestion } from '../src/format/txt';

const choice = (label: string, text: string, checked = false, correct: boolean | null = null): Choice => ({ label, text, hasImage: false, checked, correct });

function single(id: string, text: string, choices: Choice[], outcome: 'correct' | 'incorrect' | null): Question {
  return {
    id,
    number: '2',
    slot: 2,
    qtype: 'multichoice',
    kind: 'single',
    typeName: null,
    text,
    choices,
    gaps: [],
    otherText: null,
    attachments: [],
    hasPhoto: false,
    media: [],
    needsScreenshot: false,
    needs: [],
    result: outcome ? { state: null, grade: '0,00 из 1,00', outcome, rightAnswer: null, feedback: null } : null,
  };
}

// Случай из реального теста: ГЭС 100 МВт, ответ «возобновляемые» отмечен неверным, правильный скрыт.
const HPP = 'Гидроэлектростанция с установленной мощностью 100 Мегаватт относится к;';
const reviewed = single(
  'question-1-2',
  HPP,
  [
    choice('a', 'Возобновляемым источникам энергии', true, false),
    choice('b', 'Не относится к источникам энергии'),
    choice('c', 'Традиционным источникам энергии'),
  ],
  'incorrect',
);

describe('проверенные ответы из прошлых попыток', () => {
  it('из просмотра берём только подтверждённое сайтом', () => {
    const f = factFromQuestion(reviewed, '9438238', '1444279', 1)!;
    expect(f.wrong).toEqual(['Возобновляемым источникам энергии']);
    expect(f.right).toEqual([]);
    expect(f.key).toBe(normalize(HPP));
  });

  it('верный выбор без отметки у варианта — по итогу вопроса', () => {
    const q = single('q', 'Биогаз по составу близок к', [choice('a', 'Нефти'), choice('b', 'Метану', true)], 'correct');
    expect(factFromQuestion(q, '1', null)!.right).toEqual(['Метану']);
  });

  it('в новой попытке варианты перемешаны — буквы берутся из неё', () => {
    const f = factFromQuestion(reviewed, '9438238', null)!;
    const next = single(
      'question-9-5',
      HPP + ' ',
      [choice('a', 'Традиционным источникам энергии'), choice('b', 'Возобновляемым  источникам энергии'), choice('c', 'Не относится к источникам энергии')],
      null,
    );
    const facts = new Map([[f.key, f]]);
    const k = knownFor(next, facts, '9500000')!;
    expect(knownLine(next, k)).toBe('= Проверено сайтом: неверно — b) «Возобновляемым источникам энергии».');
    // Своя же попытка себе не подсказка.
    expect(knownFor(next, facts, '9438238')).toBeNull();
  });

  it('объединение: свежая отметка побеждает противоречие', () => {
    const a = { ...factFromQuestion(reviewed, '1', null)! };
    const b = { ...a, right: ['Возобновляемым источникам энергии'], wrong: [], attempts: ['2'] };
    const m = mergeFact(a, b);
    expect(m.right).toEqual(['Возобновляемым источникам энергии']);
    expect(m.wrong).toEqual([]);
    expect(m.attempts).toEqual(['1', '2']);
  });

  it('справка в конце: только подтверждённые верные, без вопросов этого файла', () => {
    const law = single('q', 'Мощность ГЭС, относящихся к ВИЭ по законодательству РФ', [choice('a', 'До 25 МВт', true, true)], 'correct');
    const f1 = factFromQuestion(law, '1', '1444279')!;
    const f2 = factFromQuestion(reviewed, '1', '1444279')!;
    expect(appendix([f1, f2], new Set(), '1444279')).toEqual([
      'Справка: ответы, подтверждённые в прошлых попытках этого курса',
      '- Мощность ГЭС, относящихся к ВИЭ по законодательству РФ → До 25 МВт',
    ]);
    expect(appendix([f1], new Set([f1.key]), null)).toEqual([]);
  });

  it('скрытый правильный ответ: выбор сужается', () => {
    expect(formatQuestion(reviewed, { withResults: true })).toContain('Значит, верный — один из: b, c');
  });

  it('строка «=» и справка попадают в файл', () => {
    const next = single(
      'n',
      HPP,
      reviewed.choices.map((c) => ({ ...c, checked: false, correct: null })),
      null,
    );
    const txt = formatDocument(
      { meta: { quizTitle: 'Т', course: 'К', section: 'Тема 9', url: 'u', mode: 'attempt', totalQuestions: 1 }, exportedAt: new Date(2026, 9, 22) },
      [next],
      { known: new Map([['n', '= Проверено сайтом: неверно — a) «X».']]), appendix: ['Справка: …', '- Q → A'] },
    );
    expect(txt).toContain('Тема: Тема 9');
    expect(txt).toContain('Обозначения: = — ответ, уже подтверждённый сайтом.');
    expect(txt).toContain('= Проверено сайтом');
    expect(txt.trimEnd().endsWith('- Q → A')).toBe(true);
  });
});
