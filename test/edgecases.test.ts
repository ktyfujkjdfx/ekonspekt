import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseQuestions } from '../src/parser/page';
import { formatQuestion } from '../src/format/txt';

const doc = (html: string) =>
  new JSDOM(`<!doctype html><body id="page-mod-quiz-review">${html}</body>`, { url: 'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=1' }).window.document;
const que = (type: string, state: string, formulation: string, extra = '') => `
<div id="question-1-1" class="que ${type} deferredfeedback ${state}"><div class="info"><h4 class="h3">Вопрос <span class="rui-qno">1</span></h4>
<div class="state">Частично правильный</div><div class="grade">Баллов: 1,0 из 2,0</div></div>
<div class="content"><div class="formulation clearfix"><h4 class="accesshide">Текст вопроса</h4>${formulation}</div>${extra}</div></div>`;

const popover = (lines: string[]) =>
  `<a class="feedbacktrigger btn btn-link p-0" data-bs-toggle="popover" data-bs-content="${`<span class="feedbackspan">${lines.join('<br />')}</span>`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /"/g,
      '&quot;',
    )}" href="#"><i class="icon fa-regular ${/^Верно/.test(lines[0]) ? 'fa-circle-check text-success' : 'fa-circle-xmark text-danger'}" title="${lines[0]}" aria-label="${lines[0]}"></i></a>`;

describe('правильные ответы показаны (по исходникам Moodle 5.x)', () => {
  it('Cloze: правильный ответ из поповера текстового поля и списка (5.0: data-bs-content, 4.x: data-content)', () => {
    const d = doc(
      que(
        'multianswer',
        'partiallycorrect',
        `
      <p>Mother Teresa was born in <span class="subquestion"><label class="subq accesshide">Ответ {$а} Вопрос 1</label>
        <input type="text" value="1911" class="form-control d-inline mb-1 incorrect" readonly>
        ${popover(['Неверно', 'Правильный ответ: 1910', 'Баллов: 0,0 из 1,0'])}</span>.
      She was <span class="subquestion"><select class="select form-select form-select d-inline-block mb-1incorrect" disabled>
        <option value="">&nbsp;</option><option value="0" selected>nun</option><option value="1">nurse</option></select>
        ${popover(['Неверно', 'Правильный ответ: nurse', 'Баллов: 0,0 из 1,0']).replace('data-bs-content', 'data-content')}</span>.</p>`,
      ),
    );
    const [q] = parseQuestions(d, { withResults: true });
    expect(q.gaps).toEqual([
      { kind: 'text', label: '[1]', options: [], answer: '1911', correct: false, rightAnswer: '1910' },
      { kind: 'select', label: '[2]', options: ['nun', 'nurse'], answer: 'nun', correct: false, rightAnswer: 'nurse' },
    ]);
    const txt = formatQuestion(q, { withResults: true });
    expect(txt).toContain('[1] 1911 ✗ → правильно: 1910\n[2] nun ✗ → правильно: nurse  (nun / nurse)');
    expect(q.text).toBe('Mother Teresa was born in [1].\nShe was [2].'.replace('\n', ' '));
  });

  it('Cloze: вертикальные радиокнопки (MCV) с собственным .outcome', () => {
    const d = doc(
      que(
        'multianswer',
        'incorrect',
        `
      <p>Choose:</p><fieldset class="answer"><legend class="accesshide">Множественный выбор 1</legend>
        <div class="form-check"><input type="radio" id="a1" checked disabled><label for="a1">red</label> <i class="icon text-danger" title="Неверно"></i></div>
        <div class="form-check"><input type="radio" id="a2" disabled><label for="a2">green</label></div>
      </fieldset><div class="outcome"><div class="feedback"><div class="rightanswer">Правильный ответ: green</div></div></div><p>end</p>`,
      ),
    );
    const [q] = parseQuestions(d, { withResults: true });
    expect(q.gaps[0]).toEqual({ kind: 'radio', label: '[1]', options: ['red', 'green'], answer: 'red', correct: false, rightAnswer: 'green' });
    expect(q.text).toBe('Choose:\n[1]\nend');
    expect(q.kind).toBe('match');
  });

  it('несколько вариантов: правильные ответы с запятой внутри варианта', () => {
    const d = doc(
      que(
        'multichoice',
        'partiallycorrect',
        `<div class="qtext"><p>Q</p></div><fieldset class="ablock"><div class="answer">
      <div class="r0"><input type="checkbox" checked disabled id="c1" aria-labelledby="c1_label"><div id="c1_label" data-region="answer-label"><span class="answernumber">a. </span><div class="flex-fill">кот, собака</div></div></div>
      <div class="r1"><input type="checkbox" disabled id="c2" aria-labelledby="c2_label"><div id="c2_label" data-region="answer-label"><span class="answernumber">b. </span><div class="flex-fill">рыба</div></div></div>
      <div class="r0"><input type="checkbox" disabled id="c3" aria-labelledby="c3_label"><div id="c3_label" data-region="answer-label"><span class="answernumber">c. </span><div class="flex-fill">кот</div></div></div>
      </div></fieldset>`,
        '<div class="outcome"><div class="feedback"><div class="rightanswer">Правильные ответы: кот, собака, рыба</div></div></div>',
      ),
    );
    const [q] = parseQuestions(d, { withResults: true });
    expect(q.choices.map((c) => c.correct)).toEqual([true, true, false]);
  });

  it('gapselect: правильный ответ — текст с [скобками], неразрывный дефис U+2011 нормализуется', () => {
    const d = doc(
      que(
        'gapselect',
        'incorrect',
        `<div class="qtext"><p>Столица — <span class="control group1"><select class="select custom-select place1 incorrect" disabled><option value="">&nbsp;</option><option value="1" selected>Казань</option><option value="2">Москва</option></select></span>.</p></div>`,
        '<div class="outcome"><div class="feedback"><div class="rightanswer">Верный ответ: Столица — [Москва].\u2011</div></div></div>',
      ),
    );
    const [q] = parseQuestions(d, { withResults: true });
    expect(q.gaps[0]).toMatchObject({ answer: 'Казань', correct: false });
    expect(q.result?.rightAnswer).toBe('Столица — [Москва].-');
  });

  it('ddwtos: ответ по номеру выбранного элемента группы', () => {
    const d = doc(
      que(
        'ddwtos',
        'incorrect',
        `<div class="qtext"><p>The <span class="drop active place1 drop group1">&nbsp;</span> sat on the <span class="drop place2 group1">&nbsp;</span>.</p></div>
      <div class="answercontainer"><span class="draghome choice1 group1">cat</span><span class="draghome choice2 group1">mat</span></div>
      <input type="hidden" class="placeinput place1 group1" value="2"><input type="hidden" class="placeinput place2 group1" value="0">`,
      ),
    );
    const [q] = parseQuestions(d, { withResults: true });
    expect(q.text).toBe('The [1] sat on the [2].');
    expect(q.gaps.map((g) => [g.answer, g.options])).toEqual([
      ['mat', ['cat', 'mat']],
      [null, ['cat', 'mat']],
    ]);
  });

  it('numerical с единицами из списка', () => {
    const d = doc(
      que(
        'numerical',
        'correct',
        `<div class="qtext"><p>Скорость света?</p></div><div class="ablock">
      <label for="n1">Ответ:</label><span class="answer"><input type="text" id="n1" value="300000" readonly class="form-control correct"></span>
      <select name="q1:1_unit" disabled><option value="">Выберите...</option><option value="1" selected>км/с</option><option value="2">м/с</option></select></div>`,
      ),
    );
    const [q] = parseQuestions(d, { withResults: true });
    expect(q.typeName).toBe('числовой ответ');
    expect(q.gaps).toEqual([
      { kind: 'text', label: 'Ответ', options: [], answer: '300000', correct: true, rightAnswer: null },
      // Вопрос верен целиком (класс correct) — значит, и выбранные единицы верны.
      { kind: 'select', label: 'Единицы', options: ['км/с', 'м/с'], answer: 'км/с', correct: true, rightAnswer: null },
    ]);
  });

  it('ddimageortext: помечается как задание на изображении', () => {
    const d = doc(
      que(
        'ddimageortext',
        'complete',
        `<div class="qtext"><p>Подпишите части</p></div><div class="ddarea"><div class="droparea"><img class="dropbackground" src="https://e.sfu-kras.ru/pluginfile.php/1/bg.png"></div>
      <div class="draghomes"><div class="draghome choice1 group1">ядро</div><div class="draghome choice2 group1">мембрана</div></div></div>`,
      ),
    );
    const [q] = parseQuestions(d);
    expect(q).toMatchObject({ needsScreenshot: true, hasPhoto: true, typeName: 'перетаскивание на изображение' });
    expect(q.gaps[0].options).toEqual(['ядро', 'мембрана']);
    expect(formatQuestion(q)).toContain('Вопрос 1 [задание на изображении]');
    expect(formatQuestion(q)).toContain(
      '! Для ответа нужно: изображение (смотрите вопрос на сайте). В этом тексте его нет, поэтому ответ не угадывать, а сверить с материалом.',
    );
    expect(formatQuestion(q)).toContain('Элементы: ядро / мембрана');
  });
});

describe('формулы', () => {
  it('исходный TeX (HTML с сервера, до MathJax), MathJax 2, MathJax 3/4, filter_tex', () => {
    const d = doc(
      que(
        'multichoice',
        'complete',
        `<div class="qtext">
      <p>A: <span class="filter_mathjaxloader_equation"><span class="nolink">\\(x^2+1\\)</span></span></p>
      <p>B: <span class="MathJax_Preview">x2</span><span class="MathJax">x2</span><script type="math/tex">y_1</script></p>
      <p>C: <mjx-container class="MathJax" data-latex="\\frac{a}{b}"><mjx-math>ab</mjx-math></mjx-container></p>
      <p>D: <img class="texrender" title="\\sqrt{2}" alt="sqrt" src="https://e.sfu-kras.ru/filter/tex/pix.php/1.gif"></p>
      </div>`,
      ),
    );
    const [q] = parseQuestions(d);
    expect(q.text).toBe('A: \\(x^2+1\\)\nB: \\(y_1\\)\nC: \\(\\frac{a}{b}\\)\nD: \\sqrt{2}');
    expect(q.hasPhoto).toBe(false);
  });
});

describe('медиа', () => {
  it('YouTube через videojs, iframe Vimeo, H5P', () => {
    const d = doc(
      que(
        'description',
        'complete',
        `<div class="qtext">
      <div class="mediaplugin mediaplugin_videojs"><video data-setup-lazy='{"techOrder": ["youtube"], "sources": [{"type": "video/youtube", "src": "https://www.youtube.com/watch?v=abc"}]}'></video></div>
      <iframe src="https://player.vimeo.com/video/1"></iframe>
      <iframe class="h5p-iframe" src="https://e.sfu-kras.ru/h5p/embed.php?url=x.h5p" title="Тренажёр"></iframe></div>`,
      ).replace('description deferredfeedback', 'description informationitem'),
    );
    const [q] = parseQuestions(d);
    expect(q.media.map((m) => m.kind)).toEqual(['youtube', 'vimeo', 'h5p']);
    expect(q.text).toContain('[видео YouTube: https://www.youtube.com/watch?v=abc]');
    expect(q.text).toContain('[интерактивное задание: Тренажёр]');
  });
});

describe('устойчивость', () => {
  it('битая/пустая разметка не роняет парсер', () => {
    const d = doc('<div class="que"></div><div id="question-1-2" class="que weirdtype"><div class="content"></div></div>');
    const qs = parseQuestions(d, { withResults: true });
    expect(qs).toHaveLength(2);
    expect(() => qs.map((q) => formatQuestion(q, { withResults: true }))).not.toThrow();
  });

  it('Placement на 120 вопросов разбирается без катастрофического замедления (jsdom)', () => {
    // jsdom в разы медленнее браузера (в браузере 120 вопросов — 0,1–0,2 с, см. e2e). Тест ловит квадратичный рост
    // и зависания, а не миллисекунды: сначала прогрев (холодный старт на CI), потом замер с запасом под медленные машины.
    const html = readFileSync(resolve(process.cwd(), 'test/fixtures/review-placement-120.html'), 'utf8');
    parseQuestions(new JSDOM(html).window.document, { withResults: true });
    const d = new JSDOM(html).window.document;
    const t0 = performance.now();
    const qs = parseQuestions(d, { withResults: true });
    expect(qs.filter((q) => q.kind !== 'info')).toHaveLength(120);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});
