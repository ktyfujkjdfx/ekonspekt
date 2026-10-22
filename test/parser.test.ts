import { describe, expect, it } from 'vitest';
import { loadFixture } from './helpers';
import { hasRightAnswers, parseAttemptSummary, parsePageMeta, parseQuestions, parseViewPage } from '../src/parser/page';

const ATTEMPT_URL = 'https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=9437135&cmid=1444264&page=9';

// ─────────────── реальные страницы e.sfu-kras.ru (обезличены) ───────────────

describe('attempt: один вариант (Тест по Теме 2, стр. 10 из 10)', () => {
  const doc = loadFixture('attempt-multichoice-single.html', ATTEMPT_URL);

  it('метаданные страницы', () => {
    const m = parsePageMeta(doc, ATTEMPT_URL);
    expect(m.mode).toBe('attempt');
    expect(m.quizTitle).toBe('Тест по Теме 2');
    expect(m.course).toBe('Учебный курс E');
    expect(m.attemptId).toBe('9437135');
    expect(m.cmid).toBe('1444264');
    expect(m.totalQuestions).toBe(10);
    expect(m.pages).toHaveLength(10);
    expect(m.currentPage).toBe(9);
    expect(m.freeNavigation).toBe(true);
    expect(m.pages[2]).toEqual({
      page: 2,
      url: 'https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=9437135&cmid=1444264&page=2',
      numbers: ['3'],
    });
    expect(m.pages[0].url).not.toContain('page=');
  });

  it('вопрос 10', () => {
    const [q] = parseQuestions(doc);
    expect(q).toMatchObject({ number: '10', slot: 10, qtype: 'multichoice', kind: 'single', hasPhoto: false, media: [] });
    expect(q.text).toBe('Почему так актуален вопрос сохранения биологического разнообразия;');
    expect(q.choices.map((c) => `${c.label}) ${c.text}`)).toEqual([
      'a) получение новых пищевых продуктов',
      'b) сохранение среды обитания человека',
      'c) сохранение редких видов',
      'd) получение новых лекарств',
      'e) развитие ряда отраслей промышленности',
    ]);
    expect(q.choices[1].checked).toBe(true);
  });
});

describe('review: соответствие (match), правильность скрыта', () => {
  const url = 'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9421455&cmid=1470491';
  const doc = loadFixture('review-match.html', url);

  it('метаданные, 63 страницы, сводка попытки', () => {
    const m = parsePageMeta(doc, url);
    expect(m.mode).toBe('review');
    expect(m.totalQuestions).toBe(63);
    expect(m.pages).toHaveLength(63);
    expect(m.pages[1].url).toBe('https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9421455&cmid=1470491&page=1');
    expect(parseAttemptSummary(doc)).toContainEqual({ title: 'Баллы', value: '73/75' });
    expect(parseAttemptSummary(doc)).toContainEqual({ title: 'Оценка', value: '5 из 5 (97%)' });
    expect(hasRightAnswers(doc)).toBe(false);
  });

  it('строки соответствия и ответы; полный балл → все строки верны', () => {
    const [q] = parseQuestions(doc, { withResults: true });
    expect(q.kind).toBe('match');
    expect(q.gaps).toHaveLength(5);
    expect(q.gaps[0].label).toMatch(/^Вместе с другими признаками/);
    expect(q.gaps[0].options).toEqual(['уровня', 'диалекты', 'народности', 'достоянием', 'общность']);
    expect(q.gaps.map((g) => g.answer)).toEqual(['общность', 'народности', 'диалекты', 'достоянием', 'уровня']);
    expect(q.gaps.every((g) => g.correct === true)).toBe(true);
    expect(q.result).toMatchObject({ state: 'Выполнен', grade: '2 из 2', outcome: 'correct', rightAnswer: null, feedback: 'Ваш ответ верный.' });
  });

  it('без режима результатов ответы в тексте не светятся', () => {
    const [q] = parseQuestions(doc);
    expect(q.result).toBeNull();
    expect(q.text).not.toContain('общность');
  });
});

describe('review: короткий ответ', () => {
  const [q] = parseQuestions(loadFixture('review-shortanswer.html'), { withResults: true });
  it('поле «Ответ» с ответом студента', () => {
    expect(q).toMatchObject({ number: '38', kind: 'other', typeName: 'короткий ответ', otherText: null });
    expect(q.text).toBe('Лингвистика, предполагающая построение лингвистических теорий, называется...');
    expect(q.gaps).toEqual([{ kind: 'text', label: 'Ответ', options: [], answer: 'теоретическая', correct: false, rightAnswer: null }]);
    expect(q.result?.outcome).toBe('incorrect');
  });
});

describe('review: несколько вариантов', () => {
  const [q] = parseQuestions(loadFixture('review-multichoice-multi.html'), { withResults: true });
  it('checkbox, отмеченные и верные', () => {
    expect(q.kind).toBe('multi');
    expect(q.choices.map((c) => c.checked)).toEqual([false, true, true, true, true]);
    expect(q.choices.map((c) => c.correct)).toEqual([false, true, true, true, true]);
    expect(q.text.startsWith('функцию языка быть средством')).toBe(true);
  });
});

describe('review: Cloze с аудио', () => {
  const doc = loadFixture('review-cloze-audio.html');
  const [q] = parseQuestions(doc, { withResults: true });
  it('17 текстовых пропусков, аудио, ответы и правильность по иконкам', () => {
    expect(q).toMatchObject({ qtype: 'multianswer', kind: 'other', typeName: 'вложенные ответы' });
    expect(q.media).toEqual([
      {
        kind: 'audio',
        title: 'Mother_Teresa.mp3',
        url: 'https://e.sfu-kras.ru/pluginfile.php/4163774/question/questiontext/7351127/1/2083942/Mother_Teresa.mp3',
      },
    ]);
    expect(q.gaps).toHaveLength(17);
    expect(q.gaps[0]).toEqual({ kind: 'text', label: '[1]', options: [], answer: '1910 and died', correct: false, rightAnswer: null });
    expect(q.gaps[1]).toMatchObject({ answer: 'the world over for', correct: true });
    expect(q.text).toContain('[аудио: Mother_Teresa.mp3]');
    expect(q.text).toContain('Mother Teresa was born in Albania in [1] 1997.');
    expect(q.text).toContain('the poor, sick, [4].');
    expect(q.text).not.toMatch(/Ответ \{\$а\}|Неверно|Баллов/);
    expect(q.result).toMatchObject({ grade: '9,0 из 17,0', outcome: 'partial' });
  });

  it('без результатов значения полей в текст не попадают', () => {
    const [plain] = parseQuestions(doc);
    expect(plain.text).not.toContain('1910 and died');
  });
});

describe('review: Cloze с внешним виджетом и таблицей слов', () => {
  const qs = parseQuestions(loadFixture('review-cloze-widget.html'), { withResults: true });
  it('виджет onlinetestpad отмечен, пропуск-список', () => {
    expect(qs[0].media).toEqual([{ kind: 'widget', title: 'onlinetestpad.com', url: null }]);
    expect(qs[0].text).toContain('[внешнее задание: onlinetestpad.com, откройте на странице]');
    expect(qs[0].gaps).toHaveLength(1);
  });
  it('таблица слов для вставки + 9 пропусков', () => {
    expect(qs[1].text).toContain('| may feel');
    expect(qs[1].gaps).toHaveLength(9);
    expect(qs[1].gaps[7]).toMatchObject({ answer: 'mau suffer', correct: false });
    expect(qs[1].text).not.toContain('mso-');
  });
});

describe('review: Cloze с таблицами и выпадающими списками', () => {
  const qs = parseQuestions(loadFixture('review-cloze-tables.html'), { withResults: true });
  it('7 вопросов, у второго — только списки → «выбор»', () => {
    expect(qs).toHaveLength(7);
    expect(qs[0].kind).toBe('other');
    expect(qs[0].gaps).toHaveLength(14);
    expect(qs[0].text).toContain('| +');
    expect(qs[1].kind).toBe('match');
    expect(qs[1].gaps[0]).toEqual({ kind: 'select', label: '[1]', options: ['John', 'I'], answer: 'I', correct: true, rightAnswer: null });
    expect(qs[1].gaps[5]).toMatchObject({ answer: 'had', correct: false });
  });
});

describe('review: разные типы + информационные блоки', () => {
  const doc = loadFixture('review-mixed-description.html');
  const qs = parseQuestions(doc, { withResults: true });
  it('номера: инфо-блоки помечены «i», вопросы по порядку', () => {
    expect(qs.map((q) => q.number)).toEqual(['1', '2', 'i', '3', '4', '5', '6', '7', '8', 'i']);
    expect(qs.filter((q) => q.kind === 'info')).toHaveLength(2);
  });
  it('навигация не считает инфо-блоки вопросами', () => {
    expect(parsePageMeta(doc, 'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=1').totalQuestions).toBe(8);
  });
  it('match с отзывом, Cloze с аудио, короткие ответы', () => {
    expect(qs[0].kind).toBe('match');
    expect(qs[0].gaps[7]).toMatchObject({ label: 'troublesome', answer: 'extremely wet' });
    expect(qs[1].media[0]).toMatchObject({ kind: 'audio', title: 'iwta-living-on-my-own.mp3' });
    expect(qs[1].gaps).toHaveLength(26);
    expect(qs[3].gaps[0]).toMatchObject({ label: 'Ответ', answer: 'I like my job because my coworkers are friendly and the pay is high.', correct: true });
  });
});

describe('review: видео, эссе, инфо-блоки с фото', () => {
  const qs = parseQuestions(loadFixture('review-video-essay.html'), { withResults: true });
  it('эссе: ответ студента, без «правильного ответа»', () => {
    const essay = qs.find((q) => q.qtype === 'essay')!;
    expect(essay.typeName).toBe('эссе');
    expect(essay.gaps[0].kind).toBe('essay');
    expect(essay.gaps[0].answer).toMatch(/^Student life in Russia presents/);
  });
  it('видео в инфо-блоке', () => {
    const withVideo = qs.find((q) => q.media.length)!;
    expect(withVideo.kind).toBe('info');
    expect(withVideo.media[0]).toMatchObject({ kind: 'video', title: 'Russias foreign students.mp4' });
  });
  it('инфо-блок с фотографиями', () => {
    expect(qs.some((q) => q.kind === 'info' && q.hasPhoto)).toBe(true);
  });
});

describe('review: Placement test, 120 вопросов на одной странице', () => {
  const doc = loadFixture('review-placement-120.html');
  const qs = parseQuestions(doc, { withResults: true });
  it('все 120 вопросов с одним вариантом', () => {
    expect(qs).toHaveLength(120);
    expect(qs.every((q) => q.kind === 'single' && q.choices.length >= 3)).toBe(true);
    expect(qs.map((q) => q.number)).toEqual(Array.from({ length: 120 }, (_, i) => String(i + 1)));
    expect(qs[0].text).toBe("I don't know how much this card costs. The price label's ______ off.");
    expect(qs.some((q) => q.hasPhoto)).toBe(false);
  });
});

describe('review: вопрос с картинкой', () => {
  const [q] = parseQuestions(loadFixture('review-image.html'), { withResults: true });
  it('фото найдено, иконки и аватар не считаются', () => {
    expect(q.hasPhoto).toBe(true);
    expect(q.text).toContain('[изображение]');
    expect(q.choices).toHaveLength(3);
  });
});

describe('view.php: просмотр не разрешён', () => {
  it('распознаёт «Не разрешается»', () => {
    const v = parseViewPage(loadFixture('view-review-not-allowed.html', 'https://e.sfu-kras.ru/mod/quiz/view.php?id=1'));
    expect(v.reviewBlocked).toBe(true);
    expect(v.reviewLinks).toEqual([]);
  });
});

// ─────────────── синтетика: типы, которых пока нет в реальных примерах ───────────────

describe('attempt: синтетические типы', () => {
  const doc = loadFixture('synthetic-attempt-types.html');
  const qs = parseQuestions(doc);
  const byNum = Object.fromEntries(qs.map((q) => [q.number, q]));

  it('находит все блоки, номера из Moodle', () => {
    expect(qs.map((q) => q.number)).toEqual(['1', '2', '3', '4', 'i', '5', '6']);
    expect(parsePageMeta(doc, 'https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=1&cmid=555').totalQuestions).toBe(6);
  });

  it('несколько вариантов + картинка в варианте', () => {
    const q = byNum['1'];
    expect(q.kind).toBe('multi');
    expect(q.text).toBe('Какие из перечисленных устройств являются устройствами ввода?\n• подумайте\n• выберите все');
    expect(q.choices[2]).toMatchObject({ label: 'c', text: 'мышь [изображение]', hasImage: true });
    expect(q.hasPhoto).toBe(true);
  });

  it('соответствие', () => {
    expect(byNum['2'].kind).toBe('match');
    expect(byNum['2'].gaps).toEqual([
      { kind: 'select', label: 'MS-DOS', options: ['Microsoft', 'Apple', 'IBM'], answer: null, correct: null, rightAnswer: null },
      { kind: 'select', label: 'macOS', options: ['Microsoft', 'Apple', 'IBM'], answer: null, correct: null, rightAnswer: null },
    ]);
  });

  it('выбор пропущенных слов', () => {
    const q = byNum['3'];
    expect(q.kind).toBe('match');
    expect(q.text).toBe('Столица России — [1], а столица Франции — [2].');
    expect(q.gaps.map((g) => g.label)).toEqual(['[1]', '[2]']);
    expect(q.gaps[1].options).toEqual(['Москва', 'Париж']);
  });

  it('короткий ответ с картинкой в тексте', () => {
    const q = byNum['4'];
    expect(q).toMatchObject({ kind: 'other', typeName: 'короткий ответ', hasPhoto: true });
    expect(q.text).toBe('Сколько бит в байте?\n[изображение]');
    expect(q.gaps[0]).toMatchObject({ kind: 'text', label: 'Ответ', answer: null });
  });

  it('информационный блок, верно/неверно, смайл не считается фото, таблица', () => {
    expect(byNum['i'].kind).toBe('info');
    const tf = byNum['5'];
    expect(tf.kind).toBe('single');
    expect(tf.hasPhoto).toBe(false);
    expect(tf.choices.map((c) => c.text)).toEqual(['Верно', 'Неверно']);
    expect(tf.text).toContain('| Уровень | Протокол |');
    expect(tf.text).toContain('| 4       | TCP |');
  });

  it('неизвестный тип не ломается', () => {
    const q = byNum['6'];
    expect(q.kind).toBe('other');
    expect(q.typeName).toBeNull();
    expect(q.otherText).toBe('• Шаг Б\n• Шаг А');
  });
});

describe('review: синтетическая страница с показанными правильными ответами', () => {
  const url = 'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9437135&cmid=1444264';
  const doc = loadFixture('synthetic-review.html', url);
  const qs = parseQuestions(doc, { withResults: true });

  it('метаданные', () => {
    expect(parsePageMeta(doc, url).pages.map((p) => p.url)).toEqual([
      'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9437135&cmid=1444264',
      'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9437135&cmid=1444264&page=1',
    ]);
    expect(hasRightAnswers(doc)).toBe(true);
  });

  it('один вариант: мой ответ, верно, правильный ответ', () => {
    expect(qs[0].result).toEqual({ state: 'Верно', grade: '1,00 из 1,00', outcome: 'correct', rightAnswer: 'пять', feedback: 'Ваш ответ верный.' });
    expect(qs[0].choices.map((c) => [c.checked, c.correct])).toEqual([
      [false, false],
      [false, false],
      [true, true],
      [false, false],
    ]);
  });

  it('несколько вариантов: правильные по строке «Правильные ответы»', () => {
    expect(qs[1].result?.outcome).toBe('partial');
    expect(qs[1].choices.map((c) => c.correct)).toEqual([true, true, false]);
  });

  it('соответствие: выбранный и неверный', () => {
    expect(qs[2].gaps[0]).toMatchObject({ label: 'Вода', answer: 'H2SO4', correct: false });
    expect(qs[2].result?.rightAnswer).toBe('Вода → H2O');
  });

  it('правильный ответ скрыт — честно null', () => {
    expect(qs[3].result?.rightAnswer).toBeNull();
    expect(qs[3].result?.outcome).toBe('incorrect');
    expect(qs[3].choices.map((c) => c.correct)).toEqual([false, null]);
  });
});
