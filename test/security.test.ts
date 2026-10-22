import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { neutralize } from '../src/shared/sanitize';
import { isAllowedUrl } from '../src/shared/netguard';
import { cleanFileBase, formatQuestion, safeFileName } from '../src/format/txt';
import { parseQuestion } from '../src/parser/question';
import { parseLessonPage } from '../src/parser/lesson';
import { formatLessonDocument } from '../src/format/lesson';

/** Вредоносная разметка, которая могла бы оказаться в тексте вопроса, вариантах, alt картинок, названии теста. */
const EVIL = `
  <p>Какой ответ верный?<script>window.__pwned = 1</script></p>
  <img src="x" onerror="window.__pwned = 2" alt="<img src=x onerror=alert(1)>">
  <a href="javascript:window.__pwned=3">ссылка</a>
  <a href=" JaVaScRiPt:alert(1)">ссылка с пробелом</a>
  <iframe srcdoc="<script>parent.__pwned=4</script>"></iframe>
  <object data="data:text/html,<script>alert(5)</script>"></object>
  <svg><a xlink:href="javascript:alert(6)"><text>svg</text></a></svg>
  <div onmouseover="window.__pwned=7" style="color:red">наведи</div>
  <form action="javascript:alert(8)"><button formaction="javascript:alert(9)">ок</button></form>
  <base href="https://evil.example/">
  <p>Текст про теги: &lt;script&gt;alert(10)&lt;/script&gt;</p>`;

function evilQuestion(): Element {
  const dom = new JSDOM(`<div class="que multichoice" id="question-1-1"><div class="info"><span class="rui-qno">1</span></div>
    <div class="formulation"><div class="qtext">${EVIL}</div>
    <div class="answer"><div class="r0"><input type="radio" id="a1"><label for="a1"><span class="answernumber">a. </span><img src=x onerror="window.__pwned=11">вариант</label></div></div></div></div>`);
  return dom.window.document.querySelector('.que')!;
}

describe('безопасность: обезвреживание копий разметки (снимки, «С картинкой»)', () => {
  it('убирает скрипты, встраивания, обработчики on*, javascript:/data:text/html-ссылки, <base>', () => {
    const el = neutralize(evilQuestion().cloneNode(true) as Element);
    const html = el.outerHTML;
    expect(el.querySelectorAll('script, iframe, object, embed, base').length).toBe(0);
    const attrs = [el, ...Array.from(el.querySelectorAll('*'))].flatMap((n) => n.getAttributeNames());
    expect(attrs.filter((a) => a.startsWith('on'))).toEqual([]);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/srcdoc|formaction/i);
    expect(html).not.toMatch(/data:text\/html/i);
    // Безопасное остаётся: текст, картинки (без обработчиков), стили.
    expect(el.textContent).toContain('Какой ответ верный?');
    expect(el.querySelectorAll('img').length).toBe(2);
    expect(el.querySelector('[style]')?.getAttribute('style')).toBe('color:red');
  });

  it('обезвреживает и сам корень (картинка из вопроса для карточки)', () => {
    const img = new JSDOM('<img src="https://e.sfu-kras.ru/x.png" onload="evil()" onerror="evil()">').window.document.querySelector('img')!;
    neutralize(img);
    expect(img.getAttributeNames().sort()).toEqual(['src']);
  });
});

describe('безопасность: текст вопроса — только текст', () => {
  it('скрипты не попадают в выгрузку, теги не исполняются, текст про теги сохраняется как текст', () => {
    const q = parseQuestion(evilQuestion());
    const txt = formatQuestion(q);
    expect(txt).not.toContain('__pwned');
    expect(txt).not.toMatch(/onerror|javascript:/i);
    expect(txt).toContain('Какой ответ верный?');
    expect(txt).toContain('Текст про теги: <script>alert(10)</script>'); // это текст вопроса, а не разметка
  });

  it('лекция: вредоносная страница → чистый текст конспекта', () => {
    const doc = new JSDOM(
      `<html><body class="cmid-1"><div class="page-header-headings"><h1>Л<img src=x onerror=alert(1)></h1></div>
      <div role="main"><h2>Стр<script>alert(2)</script></h2><div class="box contents"><div class="no-overflow">${EVIL}</div></div></div></body></html>`,
      { url: 'https://e.sfu-kras.ru/mod/lesson/view.php?id=1&pageid=2' },
    ).window.document;
    const page = parseLessonPage(doc, doc.URL)!;
    const txt = formatLessonDocument(
      { title: 'Л', course: '', section: '', url: '', progress: null, finished: false, score: null, max: null, missing: [], exportedAt: new Date(0) },
      [{ ...page, seq: 1 }],
    );
    expect(txt).not.toContain('__pwned');
    expect(txt).not.toMatch(/onerror|javascript:|alert\(2\)/);
  });
});

describe('безопасность: сеть — только сайт курсов', () => {
  it.each([
    ['https://e.sfu-kras.ru/mod/quiz/review.php?attempt=1', true],
    ['/pluginfile.php/1/x.png', true],
    ['data:image/png;base64,AAAA', true],
    ['blob:https://e.sfu-kras.ru/123', true],
    ['https://fonts.gstatic.com/s/roboto.woff2', false],
    ['//evil.example/x.png', false],
    ['https://e.sfu-kras.ru.evil.example/', false],
    ['http://e.sfu-kras.ru/', false],
    ['javascript:alert(1)', false],
    ['https://evil.example/?u=https://e.sfu-kras.ru', false],
  ])('%s → %s', (url, ok) => {
    expect(isAllowedUrl(url)).toBe(ok);
  });
});

describe('безопасность: имена скачиваемых файлов', () => {
  it.each([
    ['../../Windows/System32/evil', '_.._Windows_System32_evil'],
    ['C:\\Users\\student\\x', 'C_Users_student_x'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['  Тест по Теме 9.  ', 'Тест по Теме 9'],
    ['Тест\u202Etxt.exe', 'Тест_txt.exe'],
    ['a\u0000b\u0007c', 'a_b_c'],
    ['...', 'test'],
    ['', 'test'],
  ])('%j → %j', (input, out) => {
    expect(cleanFileBase(input)).toBe(out);
  });

  it('длина не больше 80 символов, расширение — только буквы и цифры', () => {
    expect(cleanFileBase('я'.repeat(300)).length).toBe(80);
    expect(safeFileName('Тест', new Date(2026, 9, 22), 'txt/../../x')).toBe('Тест_2026-10-22.txtx');
  });
});
