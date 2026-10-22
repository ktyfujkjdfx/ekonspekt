import { clean, htmlToText, isContentImage, textOf, type Media } from './text';
import { detectNeeds, type Need } from './needs';

/**
 * Лекция Moodle (mod/lesson): цепочка страниц. Бывают страницы с материалом (текст, код, рисунки,
 * кнопки «Далее» / «Пример 1»), страницы с вопросом (форма с ответом) и финальная страница с оценкой.
 *
 * Переход между страницами — POST на continue.php: он засчитывает прохождение. Поэтому расширение
 * ничего не отправляет и не обходит лекцию само — только читает страницу, которую открыл студент.
 */

export type LessonPageKind = 'content' | 'question' | 'end' | 'feedback';
export type LessonQType = 'single' | 'multi' | 'truefalse' | 'short' | 'numerical' | 'essay' | 'matching' | 'other';

export interface LessonImage {
  src: string;
  /** Подпись: alt или имя файла. */
  name: string;
}

export interface LessonRow {
  label: string;
  options: string[];
}

export interface LessonPage {
  pageid: string;
  kind: LessonPageKind;
  title: string;
  /** Текст страницы или формулировка вопроса. Рисунки — пометками «[изображение]» по порядку `images`. */
  text: string;
  qtype?: LessonQType;
  options?: string[];
  rows?: LessonRow[];
  images: LessonImage[];
  media: Media[];
  needs: Need[];
  /** Ответ студента, если виден на странице (пересмотр лекции) или запомнен при отправке. */
  answer?: string | null;
  correct?: boolean | null;
  /** Порядок, в котором студент открывал страницы. */
  seq?: number;
  /** Страница прочитана расширением (кнопка «Собрать всю лекцию»), а не открыта студентом. */
  fetched?: boolean;
}

/** id страниц этой лекции, на которые явно ведут кнопки и ссылки (кроме «Далее» = -1 и финала -9). */
export function explicitPageIds(doc: Document, cmid: string | null): string[] {
  const main = doc.querySelector(MAIN);
  if (!main) return [];
  const ids = new Set<string>();
  main.querySelectorAll<HTMLInputElement>('input[name="jumpto"]').forEach((i) => {
    if (Number(i.value) > 0) ids.add(i.value);
  });
  main.querySelectorAll<HTMLAnchorElement>('a[href*="/mod/lesson/view.php"][href*="pageid="]').forEach((a) => {
    const href = a.href || a.getAttribute('href') || '';
    const id = param(href, 'pageid');
    if (id && Number(id) > 0 && (!cmid || param(href, 'id') === cmid)) ids.add(id);
  });
  return Array.from(ids);
}

export interface LessonMeta {
  cmid: string | null;
  title: string;
  course: string;
  section: string;
  sectionId: string | null;
  /** Ссылка на лекцию целиком (без pageid). */
  url: string;
  pageid: string | null;
  /** «Вы прошли 33% лекции». */
  progress: number | null;
  /** Страницы из меню лекции, если преподаватель его включил: можно показать «собрано N из M». */
  menu: { pageid: string; title: string }[];
}

export interface LessonEndInfo {
  /** «Оценка за ответы на вопросы: 6 из 6». */
  score: number | null;
  max: number | null;
}

const MAIN = '[role="main"], #region-main';

export function isLessonUrl(url: string): boolean {
  return /\/mod\/lesson\/(view|continue)\.php/.test(url);
}

function param(url: string, name: string): string | null {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    return null;
  }
}

export function parseLessonMeta(doc: Document, url: string): LessonMeta {
  const main = doc.querySelector(MAIN) ?? doc.body;
  const cmid = param(url, 'id') || doc.body?.className.match(/\bcmid-(\d+)/)?.[1] || main.querySelector<HTMLInputElement>('input[name="id"]')?.value || null;
  const title =
    textOf(doc.querySelector('.page-header-headings h1, #page-header h1')) || textOf(doc.querySelector('.breadcrumb a[aria-current="page"]')) || 'Лекция';
  const courseLink = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.breadcrumb a')).find((a) => /\/course\/view\.php/.test(a.getAttribute('href') || ''));
  const sectionLink = doc.querySelector('.breadcrumb a[data-section-name-for]');
  const pageid = main.querySelector<HTMLInputElement>('form[action*="continue.php"] input[name="pageid"]')?.value || param(url, 'pageid');
  const progressText = main.querySelector('.progress_bar')?.textContent || '';
  const pct = progressText.match(/(\d+)\s*%/);
  let origin = '';
  try {
    origin = new URL(url).origin;
  } catch {
    /* как есть */
  }

  // Меню лекции: ссылки на страницы этой же лекции (кроме кнопок финальной страницы и навигации курса).
  const menu: { pageid: string; title: string }[] = [];
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/mod/lesson/view.php"][href*="pageid="]'))) {
    if (a.closest('.activity-navigation, .lessonbutton, .breadcrumb') || a.classList.contains('lessonbutton')) continue;
    const id = param(a.href || a.getAttribute('href') || '', 'pageid');
    if (!id || Number(id) <= 0 || menu.some((m) => m.pageid === id)) continue;
    menu.push({ pageid: id, title: textOf(a) });
  }

  return {
    cmid,
    title,
    course: clean(courseLink?.getAttribute('title') || '') || textOf(courseLink),
    section: textOf(sectionLink),
    sectionId: sectionLink?.getAttribute('data-section-name-for') || null,
    url: cmid ? `${origin}/mod/lesson/view.php?id=${cmid}` : url,
    pageid: pageid || null,
    progress: pct ? Number(pct[1]) : null,
    menu: menu.length >= 2 ? menu : [],
  };
}

/** Заголовок страницы из <title>: «Курс: Лекция: Страница | сайт». */
/** Служебные заголовки Moodle на странице лекции — не название страницы. */
export const SERVICE_HEADING = /^(попытка|attempt)\s*:?\s*\d+$/i;

function pageTitleFromDoc(doc: Document, lessonTitle: string): string {
  const t = (doc.title || '').replace(/\s*\|[^|]*$/, '');
  const at = t.lastIndexOf(lessonTitle + ': ');
  if (at >= 0) return clean(t.slice(at + lessonTitle.length + 2));
  const parts = t.split(': ');
  return parts.length > 1 ? clean(parts[parts.length - 1]) : '';
}

function fileName(src: string): string {
  try {
    const p = decodeURIComponent(new URL(src, 'https://e.sfu-kras.ru/').pathname);
    return p.split('/').filter(Boolean).pop() || 'рисунок';
  } catch {
    return 'рисунок';
  }
}

function imagesOf(root: Element): LessonImage[] {
  return Array.from(root.querySelectorAll('img'))
    .filter((img) => isContentImage(img) && !/(^|\s)texrender(\s|$)/.test(img.className))
    .map((img) => {
      const src = (img as HTMLImageElement).src || img.getAttribute('src') || '';
      const alt = clean(img.getAttribute('alt') || '');
      // Moodle часто подставляет в alt имя файла или «image» — это не подпись.
      // Подпись — только осмысленный текст: не «image1», не имя файла и не что-то похожее на разметку.
      const useful = alt && !/[<>]/.test(alt) && !/^(image|img|picture|рисунок|изображение)?\s*\d*$/i.test(alt) && !/\.(png|jpe?g|gif|svg|webp)$/i.test(alt);
      return { src, name: useful ? alt : fileName(src) };
    })
    .filter((i) => i.src);
}

const QTYPE: Record<string, LessonQType> = {
  multichoice_singleanswer: 'single',
  multichoice_multianswer: 'multi',
  truefalse: 'truefalse',
  shortanswer: 'short',
  numerical: 'numerical',
  essay: 'essay',
  matching: 'matching',
};

/** Видимый текст варианта без самой кнопки выбора. */
function optionText(label: Element): string {
  const clone = label.cloneNode(true) as Element;
  clone.querySelectorAll('input').forEach((i) => i.remove());
  return htmlToText(clone);
}

function parseQuestionForm(form: HTMLFormElement): Pick<LessonPage, 'qtype' | 'options' | 'rows' | 'answer'> & { stem: Element | null } {
  const marker = form.querySelector<HTMLInputElement>('input[name^="_qf__lesson_display_answer_form_"]')?.name ?? '';
  const raw = marker.replace('_qf__lesson_display_answer_form_', '');
  const qtype: LessonQType = QTYPE[raw] ?? (form.querySelector('textarea') ? 'essay' : 'other');
  const stem = form.querySelector('#id_pageheadercontainer .contents, .contents');

  const options: string[] = [];
  const chosen: string[] = [];
  for (const opt of Array.from(form.querySelectorAll('.answeroption'))) {
    const label = opt.querySelector('label') ?? opt;
    const text = optionText(label);
    if (!text) continue;
    options.push(text);
    if (opt.querySelector<HTMLInputElement>('input[type="radio"]:checked, input[type="checkbox"]:checked, input[checked]')) chosen.push(text);
  }
  // Верно/неверно и вопросы без .answeroption: подписи радиокнопок.
  if (!options.length) {
    for (const input of Array.from(form.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]'))) {
      const label = input.closest('label') ?? form.querySelector(`label[for="${input.id}"]`);
      const text = label ? optionText(label) : '';
      if (text && !options.includes(text)) options.push(text);
      if (text && (input.checked || input.hasAttribute('checked'))) chosen.push(text);
    }
  }

  const rows: LessonRow[] = [];
  const picked: string[] = [];
  for (const sel of Array.from(form.querySelectorAll<HTMLSelectElement>('select'))) {
    const label = clean(
      form.querySelector(`label[for="${sel.id}"]`)?.textContent || sel.closest('.fitem')?.querySelector('.col-form-label')?.textContent || '',
    );
    const opts = Array.from(sel.options)
      .filter((o) => (o.value !== '' && o.value !== '0') || (clean(o.textContent || '') && !/^выбрать|^выберите/i.test(clean(o.textContent || ''))))
      .map((o) => clean(o.textContent || ''))
      .filter(Boolean);
    rows.push({ label: label || `Строка ${rows.length + 1}`, options: opts });
    const sopt = sel.querySelector('option[selected]') ?? (sel.selectedIndex > 0 ? sel.options[sel.selectedIndex] : null);
    if (sopt && clean(sopt.textContent || '')) picked.push(`${label} → ${clean(sopt.textContent || '')}`);
  }

  let answer: string | null = chosen.length ? chosen.join('; ') : picked.length ? picked.join('; ') : null;
  if (!answer) {
    const input = form.querySelector<HTMLInputElement>('input[type="text"][name="answer"], input[name="answer"]:not([type="hidden"])');
    const ta = form.querySelector<HTMLTextAreaElement>('textarea');
    const v = input?.value || input?.getAttribute('value') || (ta ? clean(ta.value || ta.textContent || '') : '');
    answer = v ? v : null;
  }
  return { qtype, options: options.length ? options : undefined, rows: rows.length ? rows : undefined, answer, stem };
}

/** Разбор открытой страницы лекции. null — страница без содержимого (служебная). */
export function parseLessonPage(doc: Document, url: string, meta = parseLessonMeta(doc, url)): LessonPage | null {
  const main = doc.querySelector(MAIN);
  if (!main) return null;
  const media: Media[] = [];
  const form = main.querySelector<HTMLFormElement>('form.mform[action*="continue.php"]');
  // Первый настоящий заголовок: служебные надписи Moodle («Попытка: 1», уведомления) пропускаем.
  const h2 =
    Array.from(main.querySelectorAll('h2'))
      .filter((h) => !h.closest('.alert, .notifyproblem, .notifysuccess, .notifymessage'))
      .map((h) => textOf(h))
      .find((t) => t && !SERVICE_HEADING.test(t)) ?? '';
  const pageid = meta.pageid ?? param(url, 'pageid') ?? '';

  if (form && form.querySelector('input[name^="_qf__lesson_display_answer_form_"], .answeroption, textarea, select, input[name="answer"]')) {
    const q = parseQuestionForm(form);
    const text = q.stem ? htmlToText(q.stem, { media }) : '';
    const images = q.stem ? imagesOf(q.stem) : [];
    return {
      pageid,
      kind: 'question',
      title: pageTitleFromDoc(doc, meta.title) || h2,
      text,
      qtype: q.qtype,
      options: q.options,
      rows: q.rows,
      images,
      media,
      needs: detectNeeds(text, media, images.length > 0, false),
      answer: q.answer,
      correct: null,
    };
  }

  // Ответ на вопрос с отзывом преподавателя (continue.php): «Ваш ответ», «Верно/Неверно».
  const studentAnswer = main.querySelector('.studentanswer');
  if (studentAnswer) {
    const response = main.querySelector('.response');
    const cls = response?.className || '';
    const correct = /\bcorrect\b/.test(cls) && !/\bincorrect\b/.test(cls) ? true : /\bincorrect\b/.test(cls) ? false : null;
    const stem = main.querySelector('.generalbox');
    return {
      pageid: '',
      kind: 'feedback',
      title: h2,
      text: stem ? htmlToText(stem) : '',
      images: [],
      media: [],
      needs: [],
      answer: htmlToText(studentAnswer) || null,
      correct,
    };
  }

  const contents = main.querySelector('.box.contents, .contents');
  if (contents) {
    const body = contents.querySelector('.no-overflow') ?? contents;
    const text = htmlToText(body, { media });
    const images = imagesOf(body);
    return {
      pageid,
      kind: 'content',
      title: pageTitleFromDoc(doc, meta.title) || h2,
      text,
      images,
      media,
      // На странице с материалом «!» нужен только для видео/аудио: их содержание в текст не попадёт.
      needs: detectNeeds('', media, false, false),
    };
  }

  // Только настоящий финал: у стартовой страницы («Продолжить с последней?») тоже есть кнопки-ссылки.
  if (pageid === '-9' || /лекция завершена|lesson complete|congratulations/i.test(h2)) {
    return { pageid: '-9', kind: 'end', title: h2, text: htmlToText(main.querySelector('.generalbox') ?? main), images: [], media: [], needs: [] };
  }
  return null;
}

/** Итог лекции на финальной странице: «Оценка за ответы на вопросы: 6 из 6». */
export function parseLessonEnd(doc: Document): LessonEndInfo {
  const text = clean(doc.querySelector(MAIN)?.textContent || '');
  const m =
    text.match(/(?:ответы на вопросы|за вопросы)[^\d]{0,40}(\d+(?:[.,]\d+)?)\s*из\s*(\d+(?:[.,]\d+)?)/i) ||
    text.match(/получили\s+(\d+(?:[.,]\d+)?)\s+(?:балл\S*\s+)?из\s+(\d+(?:[.,]\d+)?)/i);
  const num = (s?: string) => (s ? Number(s.replace(',', '.')) : null);
  return { score: num(m?.[1]), max: num(m?.[2]) };
}

/**
 * Ответ, который студент отправляет на странице вопроса (читаем форму в момент отправки, ничего не меняя).
 */
export function readSubmittedAnswer(form: HTMLFormElement): string | null {
  const q = parseQuestionForm(form);
  if (q.answer) return q.answer;
  // Редактор TinyMCE хранит текст в iframe до отправки формы.
  const frame = form.querySelector<HTMLIFrameElement>('iframe');
  try {
    const t = clean(frame?.contentDocument?.body?.innerText || '');
    return t || null;
  } catch {
    return null;
  }
}
