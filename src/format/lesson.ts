import type { LessonPage, LessonQType } from '../parser/lesson';
import type { Media } from '../parser/text';
import { formatDateTime, needSentence } from './txt';

/**
 * Конспект лекции: читать самому и отдавать нейросети.
 * — Страница: «## Заголовок» и текст; код — в ```; рисунки — пометками «[рисунок: …]».
 * — Вопрос: «## Вопрос N [тип]», варианты «- …» без букв: лекция перемешивает их при каждом открытии,
 *   поэтому ответ называют текстом, а не буквой. Ответ студента — тоже текстом.
 * — Строка «!» — видео/аудио/рисунок, которых в тексте нет: не угадывать.
 */
const EOL = '\r\n';
/** Одна фраза и для студента, и для нейросети. */
export const SHUFFLE_NOTE = 'Порядок вариантов на сайте меняется при каждом открытии, поэтому ориентируйтесь на текст варианта, а не на его место в списке.';

/** Служебные надписи Moodle («Попытка: 1») — не название страницы; так могло сохраниться в старых данных. */
const SERVICE_TITLE = /^(попытка|attempt)\s*:?\s*\d+$/i;
const pageTitle = (p: LessonPage, n: number) => (p.title && !SERVICE_TITLE.test(p.title.trim()) ? p.title : `Страница ${n}`);

export interface LessonDocInfo {
  title: string;
  course: string;
  section: string;
  url: string;
  progress: number | null;
  finished: boolean;
  score: number | null;
  max: number | null;
  /** Страницы меню лекции, которых нет в конспекте. */
  missing: string[];
  /** Порядок части страниц восстановлен по номерам id и может отличаться от сайта. */
  approxOrder?: boolean;
  exportedAt: Date;
}

export interface LessonFormatOptions {
  /** «pageid:номер рисунка» → путь в архиве («картинки/стр-03-1.png»). */
  imagePaths?: Map<string, string>;
  /** Ваши ответы и оценка за вопросы (переключатель «Мои ответы»). По умолчанию — да. */
  withAnswers?: boolean;
}

const QTYPE_RU: Record<LessonQType, string> = {
  single: 'один ответ',
  multi: 'несколько ответов',
  truefalse: 'верно / неверно',
  short: 'свой ответ',
  numerical: 'число',
  essay: 'эссе',
  matching: 'соответствие',
  other: 'вопрос',
};

export function lessonTypeShort(p: LessonPage): string {
  if (p.kind !== 'question') return 'Страница лекции';
  const t = QTYPE_RU[p.qtype ?? 'other'];
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function imageKey(pageid: string, i: number): string {
  return `${pageid}:${i}`;
}

/** «[изображение]» по порядку → «[рисунок: подпись]» или путь к файлу в архиве. */
function withImages(p: LessonPage, opts: LessonFormatOptions): string {
  let i = 0;
  return p.text.replace(/\[изображение\]/g, () => {
    const img = p.images[i];
    const path = opts.imagePaths?.get(imageKey(p.pageid, i));
    i++;
    if (path) return `[рисунок: ${path}]`;
    return img ? `[рисунок: ${img.name}]` : '[рисунок]';
  });
}

function mediaWord(m: Media): string {
  if (m.kind === 'audio') return `аудио «${m.title}»`;
  if (m.kind === 'video' || m.kind === 'youtube' || m.kind === 'vimeo') return /^https?:/.test(m.title) ? `видео ${m.title}` : `видео «${m.title}»`;
  return m.kind === 'h5p' ? `интерактивное задание «${m.title}»` : `встроенный материал (${m.title})`;
}

/** Для страницы с материалом: чего нет в тексте. Для вопроса — общая строка «!». */
function noteLine(p: LessonPage, opts: LessonFormatOptions): string | null {
  if (p.kind === 'question') {
    const path = p.images.length ? opts.imagePaths?.get(imageKey(p.pageid, 0)) : undefined;
    return needSentence(p.needs, path);
  }
  if (!p.media.length) return null;
  return `! Здесь ${p.media.map(mediaWord).join(', ')}: в текст не попало, смотрите на странице лекции.`;
}

function indentLines(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l, i) => (i ? pad + l : l))
    .join('\n');
}

/** Ответ студента — текстом (буквы в лекции не постоянны). */
function answerLine(p: LessonPage): string | null {
  if (!p.answer) return null;
  const mark = p.correct === true ? ' ✓' : p.correct === false ? ' ✗' : '';
  if (p.qtype === 'essay') return `Ваш ответ (эссе):\n${p.answer}`;
  const parts = p.answer.split('; ').map((a) => (p.options?.length ? `«${oneLine(a)}»` : a));
  return `Ваш ответ: ${parts.join('; ')}${mark}`;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' / ');

function questionBody(p: LessonPage, opts: LessonFormatOptions, withAnswer: boolean): string[] {
  const L: string[] = [];
  L.push(withImages(p, opts) || '(текст вопроса не найден)');
  const note = noteLine(p, opts);
  if (note) L.push(note);
  // Варианты — своим значком, чтобы не путать с пунктами списка в тексте: ○ один ответ, □ несколько.
  const mark = p.qtype === 'multi' ? '□' : '○';
  p.options?.forEach((o) => L.push(`${mark} ${indentLines(o, '  ')}`));
  if (p.rows?.length) {
    const first = p.rows[0].options.join('\u0000');
    const same = p.rows.every((r) => r.options.join('\u0000') === first);
    if (same && p.rows[0].options.length) L.push(`Варианты: ${p.rows[0].options.join(' / ')}`);
    for (const r of p.rows) L.push(`- ${r.label} → ?${same ? '' : ` (${r.options.join(' / ')})`}`);
  }
  if (p.qtype === 'short' || p.qtype === 'numerical') L.push(p.qtype === 'numerical' ? 'Ответ: ___ (число)' : 'Ответ: ___');
  if (p.qtype === 'essay' && !(withAnswer && p.answer)) L.push('Ответ: развёрнутый текст');
  if (withAnswer) {
    const a = answerLine(p);
    if (a) L.push(a);
  }
  return L;
}

function contentBody(p: LessonPage, opts: LessonFormatOptions): string[] {
  const L: string[] = [];
  const note = noteLine(p, opts);
  if (note) L.push(note);
  L.push(withImages(p, opts));
  return L.filter(Boolean);
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10,
    b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}

/** Конспект всей лекции. */
export function formatLessonDocument(info: LessonDocInfo, pages: LessonPage[], opts: LessonFormatOptions = {}): string {
  const content = pages.filter((p) => p.kind === 'content');
  const questions = pages.filter((p) => p.kind === 'question');
  const images = pages.reduce((n, p) => n + p.images.length, 0);
  const withNotes = pages.some((p) => noteLine(p, opts));
  const withAnswers = opts.withAnswers ?? true;

  const L: string[] = [];
  L.push(info.title);
  if (info.course) L.push(`Курс: ${info.course}`);
  if (info.section) L.push(`Тема: ${info.section}`);
  const parts = [`${content.length} ${plural(content.length, 'страница', 'страницы', 'страниц')} текста`];
  if (questions.length) parts.push(`${questions.length} ${plural(questions.length, 'вопрос', 'вопроса', 'вопросов')}`);
  if (withAnswers && info.finished && info.max) parts.push(`оценка за вопросы ${info.score} из ${info.max}`);
  L.push(`Собрано: ${parts.join(', ')}`);
  L.push(`Выгружено: ${formatDateTime(info.exportedAt)}`);
  L.push(`Ссылка: ${info.url}`);
  // О пропусках пишем, только когда точно знаем, чего не хватает (меню лекции). Процент прохождения сайта
  // относится к странице, открытой первой, и вводил в заблуждение («0 %» при всех собранных страницах).
  if (info.missing.length) {
    L.push(`Не собраны страницы: ${info.missing.map((t) => `«${t}»`).join(', ')}. Откройте их и выгрузите снова.`);
  }
  if (images) {
    L.push(
      opts.imagePaths?.size
        ? `Рисунки (${images}) — в папке «картинки»: пометка [рисунок: …] указывает файл.`
        : `Рисунки (${images}) в текст не попали: на их месте пометка [рисунок: …]. Сами рисунки — в архиве ZIP или на странице лекции.`,
    );
  }
  if (info.approxOrder) {
    L.push(
      'Порядок части страниц восстановлен по их номерам на сайте и может немного отличаться. Чтобы он совпал точно, пролистайте лекцию (после завершения — «Пересмотр лекции») и выгрузите снова.',
    );
  }
  if (withNotes) L.push('Знак «!» отмечает то, чего нет в тексте (видео, аудио, рисунок): по таким местам ответ не угадывают, а сверяют с материалом.');
  if (questions.length) {
    L.push('Ответы на вопросы сверяйте с текстом лекции: термины и определения в курсе могут отличаться от общепринятых.');
    if (questions.some((q) => (q.options?.length ?? 0) > 1)) L.push(SHUFFLE_NOTE);
    L.push('Отвечая, начинайте каждый ответ с начала формулировки вопроса, а не только с номера: на сайте вопросы без номеров.');
  }

  let qn = 0;
  let pn = 0;
  const body = pages
    .map((p) => {
      if (p.kind === 'question') {
        qn++;
        return [`## Вопрос ${qn} [${QTYPE_RU[p.qtype ?? 'other']}]`, ...questionBody(p, opts, withAnswers)].join('\n');
      }
      if (p.kind === 'content') return [`## ${pageTitle(p, ++pn)}`, ...contentBody(p, opts)].join('\n');
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  return (L.join('\n') + '\n\n' + body + '\n').replace(/\n/g, EOL);
}

/** Страница с материалом — в буфер обмена. */
export function formatLessonPageForClipboard(p: LessonPage, lessonTitle: string): string {
  return [`## ${p.title && !SERVICE_TITLE.test(p.title.trim()) ? p.title : lessonTitle}`, ...contentBody(p, {})].join('\n');
}

const EXAMPLE = /пример[аеуы]?\s*(?:№\s*)?(\d+)/i;
const PREVIOUS = /предыдущ\S*\s+(?:вопрос|задани)/i;

/**
 * Вопрос лекции — в буфер обмена. Если он ссылается на «Пример N» или на предыдущий вопрос,
 * подкладываем их из уже открытых страниц: без них вопрос не решить.
 */
export function formatLessonQuestionForClipboard(p: LessonPage, lessonTitle: string, known: LessonPage[] = []): string {
  const L: string[] = [`Лекция «${lessonTitle}»`];
  const ordered = [...known].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const here = ordered.findIndex((x) => x.pageid === p.pageid);
  const before = here >= 0 ? ordered.slice(0, here) : ordered;

  if (PREVIOUS.test(p.text)) {
    const prev = [...before].reverse().find((x) => x.kind === 'question');
    if (prev) L.push('', 'Предыдущий вопрос:', ...questionBody(prev, {}, true));
  }
  const ex = p.text.match(EXAMPLE);
  if (ex) {
    const re = new RegExp(`пример[аеуы]?\\s*(?:№\\s*)?${ex[1]}(?!\\d)`, 'i');
    const page = [...before].reverse().find((x) => x.kind === 'content' && re.test(x.title)) ?? ordered.find((x) => x.kind === 'content' && re.test(x.title));
    if (page) L.push('', `К вопросу — ${page.title}:`, ...contentBody(page, {}));
    else L.push('', `! Вопрос ссылается на пример ${ex[1]}: откройте страницу с ним, и он подставится сюда сам.`);
  }
  L.push('', `Вопрос [${QTYPE_RU[p.qtype ?? 'other']}]`, ...questionBody(p, {}, false));
  if ((p.options?.length ?? 0) > 1) L.push(SHUFFLE_NOTE);
  return L.join('\n');
}

/** Лекция как материал к тесту: только текст страниц, без вопросов и служебных строк. */
export function formatLessonAsMaterial(title: string, pages: LessonPage[]): string {
  const body = pages.filter((p) => p.kind === 'content' && p.text.trim()).map((p, i) => [`### ${pageTitle(p, i + 1)}`, ...contentBody(p, {})].join('\n'));
  return body.length ? [`## Лекция «${title}»`, ...body].join('\n\n') : '';
}
