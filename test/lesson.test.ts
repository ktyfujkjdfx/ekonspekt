import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { loadFixture } from './helpers';
import { isLessonUrl, parseLessonEnd, parseLessonMeta, parseLessonPage, type LessonPage } from '../src/parser/lesson';
import { formatLessonAsMaterial, formatLessonDocument, formatLessonQuestionForClipboard, imageKey } from '../src/format/lesson';
import { factFromLessonPage } from '../src/format/known';
import { answerRule } from '../src/format/txt';
import { relevantLessons } from '../src/content/lectures';
import type { StoredLesson } from '../src/content/lessonStore';

const BASE = 'https://e.sfu-kras.ru/mod/lesson/view.php?id=1769636';
const lf = (s: string) => s.replace(/\r\n/g, '\n');

/** Минимальная страница лекции в разметке Moodle 4 (как в сохранённых страницах). */
function lessonDoc(main: string, title = 'Страница'): Document {
  const html = `<html><head><title>КУРС: Учебный материал: ${title} | еКурсы</title></head>
  <body id="page-mod-lesson-view" class="cmid-777">
  <ol class="breadcrumb"><li><a href="https://e.sfu-kras.ru/course/view.php?id=1" title="Учебный курс">Учебный курс</a></li>
  <li><a href="https://e.sfu-kras.ru/course/section.php?id=55" data-section-name-for="55">Неделя 1</a></li></ol>
  <div class="page-header-headings"><h1>Учебный материал</h1></div>
  <div role="main">${main}</div></body></html>`;
  return new JSDOM(html, { url: `https://e.sfu-kras.ru/mod/lesson/view.php?id=777&pageid=10` }).window.document;
}

const form = (type: string, body: string, stem = '<p>Вопрос?</p>') => `
  <form class="mform" method="post" action="https://e.sfu-kras.ru/mod/lesson/continue.php">
    <input type="hidden" name="pageid" value="10"><input type="hidden" name="_qf__lesson_display_answer_form_${type}" value="1">
    <div id="id_pageheadercontainer"><div class="contents"><div class="no-overflow">${stem}</div></div>${body}</div>
  </form>`;

const opt = (type: string, text: string, checked = false) =>
  `<div class="answeroption"><label class="form-check-label"><input type="${type}" name="answer"${checked ? ' checked' : ''}> <p>${text}</p></label></div>`;

describe('лекция: реальные страницы', () => {
  it('адрес лекции распознаётся', () => {
    expect(isLessonUrl(`${BASE}&pageid=1`)).toBe(true);
    expect(isLessonUrl('https://e.sfu-kras.ru/mod/lesson/continue.php')).toBe(true);
    expect(isLessonUrl('https://e.sfu-kras.ru/mod/quiz/view.php?id=1')).toBe(false);
  });

  it('метаданные: лекция, курс, тема, прогресс', () => {
    const url = `${BASE}&pageid=525642`;
    const meta = parseLessonMeta(loadFixture('lesson-content.html', url), url);
    expect(meta).toMatchObject({
      cmid: '1769636',
      title: 'Учебный материал 1',
      course: 'Учебный курс A 2026/27',
      section: 'Раздел 7',
      sectionId: '454758',
      url: BASE,
      pageid: '525642',
      progress: 0,
    });
  });

  it('страница с текстом: заголовок, списки, без кнопок и служебного', () => {
    const url = `${BASE}&pageid=525642`;
    const p = parseLessonPage(loadFixture('lesson-content.html', url), url)!;
    expect(p.kind).toBe('content');
    expect(p.title).toBe('Конвейеризация');
    expect(p.text).toContain('• никаких других взаимосвязей, кроме обмена данными, между подфункциями нет;');
    expect(p.text).not.toMatch(/Далее|Вы прошли|Перейти на/);
  });

  it('страница с рисунком: рисунок по порядку, имя файла', () => {
    const url = `${BASE}&pageid=525646`;
    const p = parseLessonPage(loadFixture('lesson-content-image.html', url), url)!;
    expect(p.images).toHaveLength(1);
    expect(p.images[0].name).toBe('Классиф.png');
    expect(p.text).toContain('[изображение]');
  });

  it('вопрос: формулировка, варианты, заголовок из <title>', () => {
    const url = `${BASE}&pageid=525643`;
    const p = parseLessonPage(loadFixture('lesson-question-single.html', url), url)!;
    expect(p).toMatchObject({ kind: 'question', qtype: 'single', title: 'Условия конвейеризации', pageid: '525643', answer: null });
    expect(p.text).toBe('Найдите неверно сформулированное условие применимости конвейеризации в следующем списке.\nКонвейер возможно применить, когда:');
    expect(p.options).toHaveLength(4);
    expect(p.options![2]).toBe('времена, необходимые для реализации аппаратными блоками своих действий, значительно отличаются друг от друга');
  });

  it('финальная страница: оценка за вопросы', () => {
    const url = `${BASE}&pageid=-9`;
    const doc = loadFixture('lesson-end.html', url);
    expect(parseLessonPage(doc, url)!.kind).toBe('end');
    expect(parseLessonEnd(doc)).toEqual({ score: 6, max: 6 });
  });
});

describe('лекция: типы вопросов и материалы', () => {
  it('несколько ответов, выбранные видны (пересмотр лекции)', () => {
    const doc = lessonDoc(
      form('multichoice_multianswer', opt('checkbox', 'MPI_Send', true) + opt('checkbox', 'MPI_Recv') + opt('checkbox', 'MPI_Bcast', true)),
    );
    const p = parseLessonPage(doc, doc.URL)!;
    expect(p.qtype).toBe('multi');
    expect(p.options).toEqual(['MPI_Send', 'MPI_Recv', 'MPI_Bcast']);
    expect(p.answer).toBe('MPI_Send; MPI_Bcast');
  });

  it('верно/неверно, короткий, числовой ответ, эссе', () => {
    const tf = parseLessonPage(lessonDoc(form('truefalse', opt('radio', 'Верно') + opt('radio', 'Неверно'))), BASE)!;
    expect(tf).toMatchObject({ qtype: 'truefalse', options: ['Верно', 'Неверно'] });
    const sa = parseLessonPage(lessonDoc(form('shortanswer', '<input type="text" name="answer" value="">')), BASE)!;
    expect(sa.qtype).toBe('short');
    const num = parseLessonPage(lessonDoc(form('numerical', '<input type="text" name="answer" value="42">')), BASE)!;
    expect(num).toMatchObject({ qtype: 'numerical', answer: '42' });
    const es = parseLessonPage(
      lessonDoc(form('essay', '<textarea name="answer[text]"></textarea>', '<p>Дайте краткое обоснование ответа на предыдущий вопрос.</p>')),
      BASE,
    )!;
    expect(es.qtype).toBe('essay');
  });

  it('соответствие: строки и общий список вариантов', () => {
    const sel = (id: string, label: string) => `<div class="fitem"><label for="${id}">${label}</label>
      <select id="${id}" name="response[${id}]"><option value="0">Выбрать...</option><option value="a">MPI_Send</option><option value="b">MPI_Recv</option></select></div>`;
    const p = parseLessonPage(lessonDoc(form('matching', sel('s1', 'Отправка') + sel('s2', 'Приём'))), BASE)!;
    expect(p.qtype).toBe('matching');
    expect(p.rows).toEqual([
      { label: 'Отправка', options: ['MPI_Send', 'MPI_Recv'] },
      { label: 'Приём', options: ['MPI_Send', 'MPI_Recv'] },
    ]);
  });

  it('видео на странице и в вопросе: пометка, а не тишина', () => {
    const content = parseLessonPage(
      lessonDoc(`<h2>Видео</h2><div class="box contents"><div class="no-overflow">
      <p>Посмотрите запись.</p><iframe src="https://www.youtube.com/embed/abc"></iframe></div></div>`),
      BASE,
    )!;
    expect(content.media[0].kind).toBe('youtube');
    const doc = formatLessonDocument(info(), [{ ...content, seq: 1 }]);
    expect(doc).toContain('! здесь видео https://www.youtube.com/embed/abc');
    const q = parseLessonPage(
      lessonDoc(
        form(
          'multichoice_singleanswer',
          opt('radio', 'Да') + opt('radio', 'Нет'),
          '<p>Что сказал лектор в видео?</p><audio src="https://e.sfu-kras.ru/pluginfile.php/1/lec.mp3"></audio>',
        ),
      ),
      BASE,
    )!;
    expect(q.needs.map((n) => n.kind)).toContain('audio');
  });

  it('код: отступы сохраняются, блок в ```', () => {
    const p = parseLessonPage(
      lessonDoc(`<h2>Пример 1. Обмен</h2><div class="box contents"><div class="no-overflow">
      <p>Код примера:</p><pre>int main()\n{\n    MPI_Init(NULL, NULL);\n    return 0;\n}</pre><p>Конец.</p></div></div>`),
      BASE,
    )!;
    expect(p.text).toBe('Код примера:\n```\nint main()\n{\n    MPI_Init(NULL, NULL);\n    return 0;\n}\n```\nКонец.');
  });

  it('код моноширинными абзацами (редактор Moodle) — тоже один блок', () => {
    const mono = (t: string) => `<p><span style="font-family: 'courier new', courier, monospace;">${t}</span></p>`;
    const p = parseLessonPage(
      lessonDoc(`<h2>Код</h2><div class="box contents"><div class="no-overflow">
      ${mono('if (rank == 0)')}${mono('&nbsp;&nbsp;&nbsp;&nbsp;b = 1.0;')}<p>Текст.</p></div></div>`),
      BASE,
    )!;
    expect(p.text).toBe('```\nif (rank == 0)\n    b = 1.0;\n```\nТекст.');
  });
});

function info(over: Partial<Parameters<typeof formatLessonDocument>[0]> = {}): Parameters<typeof formatLessonDocument>[0] {
  return {
    title: 'Учебный материал',
    course: 'Учебный курс',
    section: 'Неделя 1',
    url: BASE,
    progress: 100,
    finished: true,
    score: 2,
    max: 2,
    missing: [],
    exportedAt: new Date(2026, 9, 22, 15, 0),
    ...over,
  };
}

const page = (p: Partial<LessonPage> & Pick<LessonPage, 'pageid' | 'kind'>): LessonPage => ({ title: '', text: '', images: [], media: [], needs: [], ...p });

describe('конспект', () => {
  const pages: LessonPage[] = [
    page({
      pageid: '1',
      kind: 'content',
      title: 'Блокирующие функции',
      text: 'MPI_Send блокирует процесс.\n[изображение]',
      images: [{ src: 'https://e.sfu-kras.ru/x.png', name: 'схема.png' }],
      seq: 1,
    }),
    page({ pageid: '2', kind: 'content', title: 'Пример 1. Обмен', text: '```\nMPI_Send(&b, 1, MPI_FLOAT, 1, 5, MPI_COMM_WORLD);\n```', seq: 2 }),
    page({
      pageid: '3',
      kind: 'question',
      qtype: 'single',
      text: 'Проанализируйте код Примера 1. Что выведет программа?',
      options: ['a = 0', 'a = 2'],
      answer: 'a = 2',
      correct: true,
      seq: 3,
    }),
    page({
      pageid: '4',
      kind: 'question',
      qtype: 'essay',
      text: 'Дайте краткое обоснование ответа на предыдущий вопрос.',
      answer: 'Потому что процесс 1 отправил 2.',
      seq: 4,
    }),
  ];

  it('шапка, страницы, вопросы с ответами; рисунки — путь в архиве', () => {
    const txt = lf(formatLessonDocument(info(), pages, { imagePaths: new Map([[imageKey('1', 0), 'картинки/рис-01.png']]) }));
    expect(txt).toBe(
      [
        'Учебный материал',
        'Курс: Учебный курс · Тема: Неделя 1',
        '2 страницы текста, 2 вопроса, оценка 2 из 2 · 22.10.2026 15:00',
        BASE,
        'Рисунки — в папке «картинки»: вопрос с [рисунок: …] решайте по рисунку.',
        '',
        answerRule('текст лекции', true),
        'Обозначения: ○ один ответ, □ несколько; порядок вариантов на сайте другой.',
        '',
        '## Блокирующие функции',
        'MPI_Send блокирует процесс.',
        '[рисунок: картинки/рис-01.png]',
        '',
        '## Пример 1. Обмен',
        '```',
        'MPI_Send(&b, 1, MPI_FLOAT, 1, 5, MPI_COMM_WORLD);',
        '```',
        '',
        '## Вопрос 1 [один ответ]',
        'Проанализируйте код Примера 1. Что выведет программа?',
        '○ a = 0',
        '○ a = 2',
        'Ваш ответ: «a = 2» ✓',
        '',
        '## Вопрос 2 [эссе]',
        'Дайте краткое обоснование ответа на предыдущий вопрос.',
        'Ваш ответ (эссе):',
        'Потому что процесс 1 отправил 2.',
        '',
      ].join('\n'),
    );
  });

  it('без архива рисунок — подпись; незаконченная лекция и пропуски — предупреждение', () => {
    const txt = lf(formatLessonDocument(info({ finished: false, progress: 40, score: null, max: null, missing: ['Пример 2'] }), pages.slice(0, 1)));
    expect(txt).toContain('[рисунок: схема.png]');
    expect(txt).toContain('Не собраны страницы: «Пример 2» — откройте их и выгрузите снова.');
    expect(txt).toContain('сами рисунки — в ZIP или на сайте.');
    expect(txt).not.toContain('Как отвечать');
  });

  it('копирование вопроса: подставляется пример, на который он ссылается', () => {
    const txt = formatLessonQuestionForClipboard(pages[2], 'Учебный материал', pages);
    expect(txt).toBe(
      [
        'Лекция «Учебный материал»',
        '',
        'К вопросу — Пример 1. Обмен:',
        '```',
        'MPI_Send(&b, 1, MPI_FLOAT, 1, 5, MPI_COMM_WORLD);',
        '```',
        '',
        'Вопрос [один ответ]',
        'Проанализируйте код Примера 1. Что выведет программа?',
        '○ a = 0',
        '○ a = 2',
        'Порядок вариантов на сайте меняется при каждом открытии, поэтому ориентируйтесь на текст варианта, а не на его место в списке.',
      ].join('\n'),
    );
  });

  it('копирование эссе «обоснуйте предыдущий»: предыдущий вопрос с ответом', () => {
    const txt = formatLessonQuestionForClipboard(pages[3], 'Учебный материал', pages);
    expect(txt).toContain('Предыдущий вопрос:\nПроанализируйте код Примера 1. Что выведет программа?\n○ a = 0\n○ a = 2\nВаш ответ: «a = 2» ✓');
    expect(txt.endsWith('Вопрос [эссе]\nДайте краткое обоснование ответа на предыдущий вопрос.\nОтвет: развёрнутый текст')).toBe(true);
  });

  it('пример ещё не открыт — честная подсказка', () => {
    const txt = formatLessonQuestionForClipboard(pages[2], 'Учебный материал', [pages[2]]);
    expect(txt).toContain('! Вопрос ссылается на пример 1: откройте страницу с ним, и он подставится сюда сам.');
  });

  it('материал к тесту: только текст страниц, без вопросов', () => {
    const m = formatLessonAsMaterial('Учебный материал', pages);
    expect(m.startsWith('## Лекция «Учебный материал»\n\n### Блокирующие функции')).toBe(true);
    expect(m).not.toContain('Вопрос');
  });

  it('ответ лекции с подтверждением — в базу проверенных ответов', () => {
    expect(factFromLessonPage(pages[2], '777')).toMatchObject({ right: ['a = 2'], wrong: [], attempts: ['lesson:777'] });
    expect(factFromLessonPage(pages[3], '777')).toBeNull(); // эссе не проверяется автоматически
  });
});

describe('лекции к тесту', () => {
  const lesson = (over: Partial<StoredLesson>): StoredLesson => ({
    cmid: '1',
    title: 'Лекция',
    course: 'Курс',
    section: 'Тема 9',
    sectionId: '9',
    url: '',
    progress: 100,
    finished: true,
    score: null,
    max: null,
    menu: [],
    pages: { 1: page({ pageid: '1', kind: 'content', title: 'Т', text: 'текст' }) },
    pending: null,
    nextSeq: 2,
    updatedAt: 1,
    ...over,
  });

  it('та же тема курса или лекция, на которую ссылается вопрос', () => {
    const all = [
      lesson({ cmid: 'a', sectionId: '9' }),
      lesson({ cmid: 'b', sectionId: '8', title: 'Lesson 2. Family' }),
      lesson({ cmid: 'c', sectionId: '9', course: 'Другой курс' }),
      lesson({ cmid: 'd', sectionId: '7' }),
    ];
    const q = { needs: [{ kind: 'lesson', label: 'Lesson 2' }] } as never;
    const summaries = all.map((l) => ({ cmid: l.cmid, title: l.title, course: l.course, sectionId: l.sectionId, content: 1, updatedAt: l.updatedAt }));
    expect(relevantLessons(summaries, { course: 'Курс', sectionId: '9' }, [q]).map((l) => l.cmid)).toEqual(['a', 'b']);
  });
});

describe('граничные случаи лекции', () => {
  it('стартовая страница с кнопками-ссылками — не финал', () => {
    const doc = lessonDoc(`<div class="box generalbox"><p>Вы уже проходили эту лекцию. Начать с последней просмотренной страницы?</p>
      <a class="lessonbutton standardbutton" href="https://e.sfu-kras.ru/mod/lesson/view.php?id=777&pageid=5">Да</a></div>`);
    expect(parseLessonPage(doc, 'https://e.sfu-kras.ru/mod/lesson/view.php?id=777')).toBeNull();
  });

  it('вопрос теста ссылается на приложенную лекцию — «!» не пугает зря', async () => {
    const { formatQuestion } = await import('../src/format/txt');
    const q = {
      id: 'q',
      number: '1',
      slot: 1,
      qtype: 'shortanswer',
      kind: 'other',
      typeName: null,
      text: 'Use the words from Lesson 2.',
      choices: [],
      gaps: [],
      otherText: null,
      attachments: [],
      hasPhoto: false,
      media: [],
      needsScreenshot: false,
      needs: [{ kind: 'lesson', label: 'Lesson 2' }],
      result: null,
    } as never;
    expect(formatQuestion(q)).toContain('! Для ответа нужно: материал «Lesson 2»');
    const txt = formatQuestion(q, { materialTitles: ['Lesson 2. Family values'] });
    expect(txt).not.toContain('!');
    expect(txt).toContain('(материал «Lesson 2» — в конце файла)');
  });
});

describe('«Собрать всю лекцию»: какие страницы проверять', async () => {
  const { planBatch, edgeMisses, EDGE } = await import('../src/content/lessonCrawl');
  const { rememberFetchedPage, rememberPage, orderedPages, orderIsApproximate, titleNumber } = await import('../src/content/lessonStore');
  const { explicitPageIds } = await import('../src/parser/lesson');

  it('пачка: сначала явные ссылки, потом пропуски между известными, потом края вверх и вниз', () => {
    const s = { have: new Set([100, 104]), tried: new Set<number>([102]), explicit: [200] };
    expect(planBatch(s, 6)).toEqual([200, 101, 103, 105, 99, 106]);
  });

  it('край: не дальше EDGE пустых id; найденная страница сдвигает край', () => {
    const s = { have: new Set([100]), tried: new Set<number>(), explicit: [] as number[] };
    for (let id = 101; id <= 100 + EDGE; id++) s.tried.add(id);
    expect(edgeMisses(s).up).toBe(EDGE);
    expect(planBatch(s, 20).every((id) => id < 100)).toBe(true);
    s.have.add(103); // нашлась страница выше — край ушёл вверх
    expect(edgeMisses(s).up).toBe(EDGE - 3);
    expect(planBatch(s, 20)).toContain(103 + EDGE);
  });

  it('никогда не проверяет финал (-9) и id ≤ 0; проверка конечна', () => {
    const s = { have: new Set([2]), tried: new Set<number>(), explicit: [-9, 0, -1] };
    const seen: number[] = [];
    for (let b = planBatch(s); b.length; b = planBatch(s))
      b.forEach((id) => {
        seen.push(id);
        s.tried.add(id);
      });
    expect(seen.every((id) => id > 0)).toBe(true);
    expect(seen).toContain(1);
    expect(seen.length).toBeLessThanOrEqual(EDGE + 1);
  });

  it('число пачек мало: лекция из 12 страниц с одной открытой — ≤ 5 обращений «пачкой»', () => {
    const real = new Set(Array.from({ length: 12 }, (_, i) => 500 + i));
    const s = { have: new Set([505]), tried: new Set<number>(), explicit: [] as number[] };
    let rounds = 0;
    for (let b = planBatch(s); b.length; b = planBatch(s)) {
      rounds++;
      b.forEach((id) => (real.has(id) ? s.have.add(id) : s.tried.add(id)));
    }
    expect(s.have.size).toBe(12);
    expect(rounds).toBeLessThanOrEqual(5);
  });

  it('ответвления и «Пересмотр лекции» дают номера страниц, «Далее» (-1) — нет', () => {
    const doc = lessonDoc(`<h2>Т</h2><div class="box contents"><div class="no-overflow"><p>x</p></div></div>
      <form method="post" action="https://e.sfu-kras.ru/mod/lesson/continue.php"><input name="jumpto" value="-1"></form>
      <form method="post" action="https://e.sfu-kras.ru/mod/lesson/continue.php"><input name="jumpto" value="525700"></form>
      <a class="lessonbutton" href="https://e.sfu-kras.ru/mod/lesson/view.php?id=777&amp;pageid=525643">Пересмотр лекции</a>
      <a href="https://e.sfu-kras.ru/mod/lesson/view.php?id=999&amp;pageid=1">чужая лекция</a>`);
    expect(explicitPageIds(doc, '777')).toEqual(['525700', '525643']);
  });

  it('прочитанная расширением страница встаёт по порядку id между открытыми', () => {
    const rec = {
      pages: {
        10: page({ pageid: '10', kind: 'content', title: 'A', seq: 1 }),
        14: page({ pageid: '14', kind: 'content', title: 'C', seq: 2 }),
      },
      nextSeq: 3,
    } as never as StoredLesson;
    rememberFetchedPage(rec, page({ pageid: '12', kind: 'content', title: 'B' }));
    rememberFetchedPage(rec, page({ pageid: '16', kind: 'content', title: 'D' }));
    rememberFetchedPage(rec, page({ pageid: '8', kind: 'content', title: 'Z' }));
    expect(orderedPages(rec).map((p) => p.title)).toEqual(['Z', 'A', 'B', 'C', 'D']);
    expect(rec.pages[12].fetched).toBe(true);
  });

  it('страница, вставленная преподавателем позже (большой id), встаёт на место, когда студент её открывает', () => {
    const rec = { pages: {}, nextSeq: 1 } as never as StoredLesson;
    rememberPage(rec, page({ pageid: '10', kind: 'content', title: 'Начало' }));
    rememberFetchedPage(rec, page({ pageid: '11', kind: 'question', title: 'Эссе' }));
    rememberFetchedPage(rec, page({ pageid: '20', kind: 'question', title: 'Колодец' }));
    expect(orderedPages(rec).map((p) => p.title)).toEqual(['Начало', 'Эссе', 'Колодец']);
    expect(orderIsApproximate(rec)).toBe(true);
    // Студент листает «Пересмотр лекции»: сайт показывает колодец перед эссе.
    rememberPage(rec, page({ pageid: '20', kind: 'question', title: 'Колодец' }));
    rememberPage(rec, page({ pageid: '11', kind: 'question', title: 'Эссе' }));
    expect(orderedPages(rec).map((p) => p.title)).toEqual(['Начало', 'Колодец', 'Эссе']);
    expect(orderedPages(rec).map((p) => p.seq)).toEqual([1, 2, 3]);
    expect(orderIsApproximate(rec)).toBe(false);
  });

  it('порядок найденных страниц уточняется по меню лекции и номерам в названиях вопросов', () => {
    const rec = { pages: {}, nextSeq: 1, menu: [] } as never as StoredLesson;
    rememberPage(rec, page({ pageid: '10', kind: 'content', title: 'Начало' }));
    rememberFetchedPage(rec, page({ pageid: '11', kind: 'question', title: 'Вопрос 1' }));
    rememberFetchedPage(rec, page({ pageid: '12', kind: 'question', title: 'Вопрос 3' }));
    rememberFetchedPage(rec, page({ pageid: '30', kind: 'question', title: 'Вопрос 2' }));
    expect(orderedPages(rec).map((p) => p.title)).toEqual(['Начало', 'Вопрос 1', 'Вопрос 2', 'Вопрос 3']);
    rememberFetchedPage(rec, page({ pageid: '13', kind: 'content', title: 'Б' }));
    rememberFetchedPage(rec, page({ pageid: '31', kind: 'content', title: 'А' }));
    rec.menu = [
      { pageid: '10', title: 'Начало' },
      { pageid: '31', title: 'А' },
      { pageid: '13', title: 'Б' },
    ];
    const titles = orderedPages(rec).map((p) => p.title);
    expect(titles.indexOf('А')).toBeLessThan(titles.indexOf('Б'));
    expect(titleNumber('Задание №4.')).toBe(4);
    expect(titleNumber('Q12')).toBe(12);
    expect(titleNumber('Классификация 2026')).toBeNull();
  });

  it('ответ из «Пересмотра лекции»: сохраняется у новой страницы и дописывается к уже собранной', () => {
    const rec = { pages: {}, nextSeq: 1 } as never as StoredLesson;
    rememberFetchedPage(rec, page({ pageid: '5', kind: 'question', answer: 'Поток', correct: true }));
    expect(rec.pages[5].answer).toBe('Поток');
    expect(rec.pages[5].correct).toBeNull();
    rememberFetchedPage(rec, page({ pageid: '6', kind: 'question' }));
    rememberFetchedPage(rec, page({ pageid: '6', kind: 'question', answer: 'Ответ Б' }));
    expect(rec.pages[6].answer).toBe('Ответ Б');
    rememberFetchedPage(rec, page({ pageid: '6', kind: 'question', answer: 'другое' }));
    expect(rec.pages[6].answer).toBe('Ответ Б');
  });
});

describe('конспект лекции: «Мои ответы» и порядок', () => {
  const q = page({
    pageid: '2',
    kind: 'question',
    qtype: 'single',
    text: 'Что такое поток?',
    options: ['Поток', 'Базис'],
    answer: 'Поток',
    correct: true,
    seq: 1,
  });

  it('без «Моих ответов» — только вопросы, без ответа и оценки', () => {
    const on = lf(formatLessonDocument(info(), [q]));
    const off = lf(formatLessonDocument(info(), [q], { withAnswers: false }));
    expect(on).toContain('Ваш ответ: «Поток» ✓');
    expect(off).not.toContain('Ваш ответ');
    expect(on).toContain('оценка 2 из 2');
    expect(off).not.toContain('оценка 2 из 2');
    expect(off).toContain('Как отвечать: строка на вопрос');
  });

  it('приблизительный порядок — честная строка в шапке', () => {
    expect(lf(formatLessonDocument(info({ approxOrder: true }), [q]))).toContain('Порядок части страниц примерный');
    expect(lf(formatLessonDocument(info(), [q]))).not.toContain('Порядок части страниц');
  });
});

describe('«С картинкой»: подпись на снимке', async () => {
  const { mediaNote } = await import('../src/content/copyImage');
  it('видео и аудио в снимок не попадают — так и написано на снимке', () => {
    expect(mediaNote([])).toBeUndefined();
    expect(mediaNote(['image'])).toBeUndefined();
    expect(mediaNote(['video', 'audio'])).toBe('В вопросе есть видео и аудио — в картинку не попало: ответ не угадывать, сверить с материалом на странице.');
  });

  it('карточка: текст и рисунки на своих местах — по имени файла или по порядку', async () => {
    const { buildCard } = await import('../src/content/copyImage');
    const img = (name: string) => Object.assign(document.createElement('img'), { src: `https://e.sfu-kras.ru/pluginfile.php/1/${name}` });
    const a = img('GPU5.png');
    const b = img('other.png');
    const card = buildCard({ text: 'Вопрос\n[рисунок: GPU5.png]\n- 8\n- 16\nСхема:[изображение]конец', images: [b, a] });
    const parts = Array.from(card.children).map((c) => (c.tagName === 'IMG' ? `IMG:${(c as HTMLImageElement).src.split('/').pop()}` : c.textContent));
    expect(parts).toEqual(['Вопрос', 'IMG:GPU5.png', '- 8\n- 16\nСхема:', 'IMG:other.png', 'конец']);
  });

  it('карточка: рисунок без пометки не теряется, задание на изображении — снимком целиком', async () => {
    const { buildCard } = await import('../src/content/copyImage');
    const extra = Object.assign(document.createElement('img'), { src: 'https://e.sfu-kras.ru/pluginfile.php/1/x.png' });
    expect(Array.from(buildCard({ text: 'Без пометок', images: [extra] }).children).map((c) => c.tagName)).toEqual(['DIV', 'IMG']);
    const snap = document.createElement('section');
    const card = buildCard({ text: 'Перетащите метки', images: [extra], snapshot: snap, note: 'В вопросе есть видео' });
    expect(Array.from(card.children).map((c) => c.tagName)).toEqual(['DIV', 'SECTION', 'DIV']);
  });
});

describe('лекция: ошибки из реальной выгрузки', () => {
  it('служебный заголовок «Попытка: 1» не становится названием страницы', () => {
    const doc = lessonDoc(
      `<div class="box"><h2>Попытка: 1</h2></div><h2>Конвейеризация</h2>
      <div class="box contents"><div class="no-overflow"><p>Текст страницы.</p></div></div>`,
      'Конвейеризация',
    );
    expect(parseLessonPage(doc, doc.URL)!.title).toBe('Конвейеризация');
  });

  it('старые данные с «Попытка: 1» в конспекте — нейтральное «Страница N»', () => {
    const txt = lf(
      formatLessonDocument(info({ finished: false, progress: 0 }), [page({ pageid: '1', kind: 'content', title: 'Попытка: 1', text: 'Текст.', seq: 1 })]),
    );
    expect(txt).toContain('## Страница 1');
    expect(txt).not.toContain('Попытка');
  });

  it('шапка не пишет «Пройдено 0 %», когда страницы собраны', () => {
    const txt = lf(
      formatLessonDocument(info({ finished: false, progress: 0, score: null, max: null }), [
        page({ pageid: '1', kind: 'content', title: 'А', text: 'Т', seq: 1 }),
      ]),
    );
    expect(txt).not.toMatch(/Пройдено|только открытые/);
    expect(txt).toContain('1 страница текста · ');
  });

  it('варианты: ○ — один ответ, □ — несколько', () => {
    const multi = page({ pageid: '2', kind: 'question', qtype: 'multi', text: 'Выберите все', options: ['A', 'B'], seq: 1 });
    expect(lf(formatLessonDocument(info(), [multi]))).toContain('□ A\n□ B');
  });
});
