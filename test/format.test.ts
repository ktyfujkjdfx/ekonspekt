import { describe, expect, it } from 'vitest';
import { loadFixture } from './helpers';
import { hasRightAnswers, parseAttemptSummary, parsePageMeta, parseQuestions } from '../src/parser/page';
import { formatDocument, formatQuestion, imageFileName, safeFileName } from '../src/format/txt';

const ATTEMPT_URL = 'https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=9437135&cmid=1444264&page=9';
const DATE = new Date(2026, 9, 21, 23, 5);
const lf = (s: string) => s.replace(/\r\n/g, '\n');

describe('formatQuestion', () => {
  it('один вариант (реальная страница): коротко и без декоративных символов', () => {
    const [q] = parseQuestions(loadFixture('attempt-multichoice-single.html', ATTEMPT_URL));
    expect(formatQuestion(q)).toBe(
      [
        'Вопрос 10 [один ответ]',
        'Почему так актуален вопрос сохранения биологического разнообразия;',
        'a) получение новых пищевых продуктов',
        'b) сохранение среды обитания человека',
        'c) сохранение редких видов',
        'd) получение новых лекарств',
        'e) развитие ряда отраслей промышленности',
      ].join('\n'),
    );
  });

  const qs = parseQuestions(loadFixture('synthetic-attempt-types.html'));

  it('фото + путь в ZIP, соответствие, пропуски-списки, свой ответ, прочий тип', () => {
    const paths = new Map([[qs[0].id, imageFileName('1')]]);
    expect(formatQuestion(qs[0], { imagePaths: paths })).toContain(
      '! Для ответа нужно: изображение картинки/вопрос-001.png. В этом тексте его нет, поэтому ответ не угадывать',
    );
    expect(formatQuestion(qs[1])).toContain(
      'Вопрос 2 [соответствие]\nСопоставьте ОС и разработчика.\nВарианты: Microsoft / Apple / IBM (лишних: 1)\n- MS-DOS → ?\n- macOS → ?',
    );
    expect(formatQuestion(qs[2])).toContain(
      'Вопрос 3 [выбор в пропусках]\nСтолица России — [1], а столица Франции — [2].\n[1] Москва / Казань\n[2] Москва / Париж',
    );
    expect(formatQuestion(qs[3])).toContain('Вопрос 4 [свой ответ]');
    expect(formatQuestion(qs[3])).toContain('\nОтвет: ___');
    expect(formatQuestion(qs[6])).toContain('Вопрос 6 [другой тип]');
  });

  it('Cloze с аудио: запрет угадывать; ответы только в режиме результатов; текстовые пропуски без лишнего списка', () => {
    const [q] = parseQuestions(loadFixture('review-cloze-audio.html'), { withResults: true });
    const plain = formatQuestion(q);
    expect(plain).toContain('! Для ответа нужно: аудио «Mother_Teresa». В этом тексте его нет, поэтому ответ не угадывать, а сверить с материалом.');
    expect(plain).not.toMatch(/^\[1\]/m);
    expect(plain).not.toContain('1910 and died');
    const withRes = formatQuestion(q, { withResults: true });
    expect(withRes).toContain('[1] 1910 and died ✗\n[2] the world over for ✓');
    expect(withRes).toContain('Итог: частично, 9,0 из 17,0');
  });

  it('Cloze со списками: варианты и ответ', () => {
    const qs2 = parseQuestions(loadFixture('review-cloze-tables.html'), { withResults: true });
    expect(formatQuestion(qs2[1])).toContain('[1] John / I');
    expect(formatQuestion(qs2[1], { withResults: true })).toContain('[1] I ✓  (John / I)');
  });

  it('видео по ссылке в тексте задания', () => {
    const qs2 = parseQuestions(loadFixture('review-cloze-tables.html'));
    expect(formatQuestion(qs2[6])).toContain('! Для ответа нужно: видео https://youtu.be/3icBxO6Wjz0.');
  });

  it('эссе: ответ студента только с результатами', () => {
    const essay = parseQuestions(loadFixture('review-video-essay.html'), { withResults: true }).find((q) => q.qtype === 'essay')!;
    expect(formatQuestion(essay)).toContain('Ответ: развёрнутый текст (эссе)');
    expect(formatQuestion(essay, { withResults: true })).toContain('Ваш ответ (эссе):\nStudent life in Russia');
    expect(formatQuestion(essay, { withResults: true })).not.toContain('Правильный ответ');
  });

  it('информационный блок', () => {
    const info = parseQuestions(loadFixture('review-mixed-description.html')).find((q) => q.kind === 'info')!;
    expect(formatQuestion(info)).toBe('Инфо\n6. Put the words in the correct order to make complete sentences.');
  });
});

describe('formatDocument', () => {
  it('шапка: коротко, только непустые счётчики, без рамок', () => {
    const doc = loadFixture('synthetic-attempt-types.html');
    const url = 'https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=1&cmid=555';
    const txt = lf(formatDocument({ meta: parsePageMeta(doc, url), exportedAt: DATE }, parseQuestions(doc)));
    expect(txt.split('\n').slice(0, 10)).toEqual([
      'Синтетический тест',
      'Курс: Информатика',
      'Вопросов: 6 (один ответ — 1, несколько ответов — 1, выбор/соответствие — 2, другие — 2)',
      'Выгружено: 21.10.2026 23:05, попытка',
      `Ссылка: ${url}`,
      'С изображением: №1, №4 (смотрите на сайте)',
      'Знак «!» отмечает вопросы, для ответа на которые нужен материал вне этого файла: такие ответы не угадывают, а сверяют с материалом.',
      'В соответствии каждый вариант обычно подходит одному пункту; «лишних: N» — варианты, которые не подходят никуда.',
      'Ответы сверяйте с материалами курса: термины, классификации и цифры в нём бывают другими, чем в общих источниках. Если вопрос оборван или склеен с чужим текстом (так бывает в самих тестах), всё равно выберите самый подходящий вариант и пометьте его как предположение: пустой ответ — 0 баллов.',
      '',
    ]);
    expect(txt).not.toMatch(/[═─\t]/);
  });

  it('неполный сбор — предупреждение', () => {
    const doc = loadFixture('attempt-multichoice-single.html', ATTEMPT_URL);
    const txt = formatDocument({ meta: parsePageMeta(doc, ATTEMPT_URL), exportedAt: DATE, missingNumbers: ['1', '2'] }, parseQuestions(doc));
    expect(txt).toContain('Не собраны: №1, №2 (всего в тесте 10). Откройте эти страницы теста и выгрузите снова.');
  });

  it('реальный review: результат попытки, скрытые правильные ответы', () => {
    const doc = loadFixture('review-cloze-audio.html');
    const url = 'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=6958707&cmid=631261';
    const txt = lf(
      formatDocument(
        { meta: parsePageMeta(doc, url), exportedAt: DATE, rightAnswersShown: hasRightAnswers(doc), attemptSummary: parseAttemptSummary(doc) },
        parseQuestions(doc, { withResults: true }),
        { withResults: true },
      ),
    );
    expect(txt).toContain('С видео/аудио: №1');
    expect(txt).toContain('Результат: баллы 9,0/17,0, оценка 5,3 из 10,0 (52,9%)');
    expect(txt).toContain('Правильные ответы преподаватель не показал');
  });

  it('синтетический review с правильными ответами', () => {
    const url = 'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9437135&cmid=1444264';
    const doc = loadFixture('synthetic-review.html', url);
    const txt = lf(
      formatDocument({ meta: parsePageMeta(doc, url), exportedAt: DATE, rightAnswersShown: hasRightAnswers(doc) }, parseQuestions(doc, { withResults: true }), {
        withResults: true,
      }),
    );
    expect(txt).toContain('Выгружено: 21.10.2026 23:05, просмотр результатов');
    expect(txt).toContain(
      [
        'Вопрос 1 [один ответ]',
        'Сколько известно периодов вымирания видов животных и растений в истории Земли;',
        'a) три',
        'b) четыре',
        'c) пять (ваш ✓)',
        'd) два',
        'Итог: верно, 1,00 из 1,00',
        'Правильный ответ: пять',
      ].join('\n'),
    );
    expect(txt).toContain('a) солнце (ваш ✓)\nb) ветер (✓)\nc) уголь');
    expect(txt).toContain('- Вода → H2SO4 ✗ (H2SO4 / H2O)');
    expect(txt).not.toContain('преподаватель не показал');
  });

  it('Placement test: 120 вопросов, быстро и компактно', () => {
    const doc = loadFixture('review-placement-120.html');
    const t0 = performance.now();
    const txt = formatDocument({ meta: parsePageMeta(doc, 'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=1'), exportedAt: DATE }, parseQuestions(doc));
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(txt.match(/\r\nВопрос \d+ \[/g)).toHaveLength(120);
    // На вопрос с 4 вариантами в среднем меньше 250 символов разметки+текста.
    expect(txt.length / 120).toBeLessThan(250);
  });
});

describe('имена файлов', () => {
  it('очищает недопустимые символы', () => {
    expect(safeFileName('Тест: «Тема 2» / часть 1?', DATE, 'txt')).toBe('Тест_ «Тема 2» _ часть 1__2026-10-21.txt');
    expect(imageFileName('12')).toBe('картинки/вопрос-012.png');
    expect(imageFileName('i', 3)).toBe('картинки/инфо-03.png');
  });
});
