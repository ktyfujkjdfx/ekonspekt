import type { Gap, Need, PageMeta, Question, SummaryRow } from '../parser/types';
import { mediaPlaceholder } from '../parser/text';
import { crossReferences } from './crossref';

/**
 * Формат выгрузки: читать человеку и отдавать нейросети.
 * — Без рамок и декоративных символов (каждый «════» — лишние токены).
 * — Вопрос: «N. [тип] текст», варианты «a) …», пропуски «[1]» прямо в тексте.
 * — Строка «! …» — для ответа нужен материал, которого в тексте нет: просим не угадывать.
 * — Строка «= …» — ответ, уже проверенный сайтом в прошлой попытке.
 */
const EOL = '\r\n';

export interface FormatOptions {
  /** Показать мои ответы, верно/неверно, правильные ответы (только review). */
  withResults?: boolean;
  /** id вопроса (Question.id) → путь снимка в архиве («картинки/вопрос-001.png»). */
  imagePaths?: Map<string, string>;
  /** id вопроса → строка «= Проверено в прошлой попытке: …». */
  known?: Map<string, string>;
  /** Справка в конце файла: подтверждённые ответы курса из прошлых попыток. */
  appendix?: string[];
  /** Лекции темы, собранные расширением, — материал в самом конце файла. */
  material?: string[];
  /** Названия приложенных лекций: отсылка «из Lesson 2» к ним уже не «нет в файле». */
  materialTitles?: string[];
  /** Пропуск → «в вопросе N: «…»»: тот же текст в другом вопросе теста (заполняет formatDocument). */
  hints?: Map<Gap, string>;
}

export interface DocumentInfo {
  meta: Pick<PageMeta, 'quizTitle' | 'course' | 'url' | 'mode' | 'totalQuestions'> & { section?: string };
  exportedAt: Date;
  /** Показаны ли на странице правильные ответы (для честной пометки). */
  rightAnswersShown?: boolean;
  /** Номера вопросов, которые не удалось собрать. */
  missingNumbers?: string[];
  /** Сводка попытки со страницы просмотра (Баллы, Оценка…). */
  attemptSummary?: SummaryRow[];
}

/** Короткая метка типа в выгрузке. */
export function typeTag(q: Question): string {
  switch (q.kind) {
    case 'single':
      return 'один ответ';
    case 'multi':
      return 'несколько ответов';
    case 'match':
      return q.gaps.some((g) => /^\[\d+\]$/.test(g.label)) ? 'выбор в пропусках' : 'соответствие';
    case 'info':
      return 'инфо';
    default:
      if (q.qtype === 'multianswer' || q.gaps.some((g) => /^\[\d+\]$/.test(g.label))) return 'пропуски';
      if (q.qtype === 'essay' || q.qtype === 'aitext') return 'эссе';
      if (q.qtype === 'ordering') return 'порядок';
      if (q.needsScreenshot) return 'задание на изображении';
      if (q.gaps.some((g) => g.label === 'Ответ')) return 'свой ответ';
      return q.typeName ?? 'другой тип';
  }
}

/** Короткая пометка для кнопки на странице. */
export function typeShort(q: Question): string {
  switch (q.kind) {
    case 'single':
      return 'Один вариант';
    case 'multi':
      return 'Несколько вариантов';
    case 'match':
      return 'Выбор / соответствие';
    case 'info':
      return 'Информация';
    default: {
      // Коротко, чтобы помещалось в строку рядом с «Копировать».
      const short: Record<string, string> = {
        multianswer: 'Пропуски',
        shortanswer: 'Свой ответ',
        numerical: 'Число',
        essay: 'Эссе',
        ddwtos: 'Перетаскивание',
        ordering: 'Порядок',
      };
      if (short[q.qtype]) return short[q.qtype];
      if (q.needsScreenshot) return 'На изображении';
      return q.typeName ? q.typeName.charAt(0).toUpperCase() + q.typeName.slice(1) : 'Другой тип';
    }
  }
}

/** Имена в архиве: «картинки/вопрос-001.png», «картинки/инфо-01.png» (UTF-8, архиватор Windows читает). */
export function imageFileName(number: string, infoIndex = 1): string {
  if (number === 'i') return `картинки/инфо-${String(infoIndex).padStart(2, '0')}.png`;
  const n = Number(number);
  const base = Number.isInteger(n) ? String(n).padStart(3, '0') : number.replace(/[^\wа-яё-]+/gi, '_');
  return `картинки/вопрос-${base}.png`;
}

const OUTCOME_RU = { correct: 'верно', incorrect: 'неверно', partial: 'частично' } as const;
const mark = (c: boolean | null) => (c === true ? ' ✓' : c === false ? ' ✗' : '');

/** «! …» — что нужно для ответа и просьба не угадывать. Одна строка на вопрос. */
/** Та же строка «!» для любых вопросов (теста и лекции). */
export function needSentence(needs: Need[], imagePath?: string): string | null {
  if (!needs.length) return null;
  const parts = needs.map((n: Need) => {
    switch (n.kind) {
      case 'video':
        return n.label === 'видео к заданию' ? 'видео' : /^https?:/.test(n.label) ? `видео ${n.label}` : `видео «${n.label}»`;
      case 'audio':
        return n.label === 'аудио к заданию' ? 'аудио' : n.label === 'запись выступления' ? n.label : `аудио «${n.label}»`;
      case 'media':
        return n.label;
      case 'lesson':
        return `материал «${n.label}»`;
      case 'text':
        return 'текст к заданию';
      case 'image':
        return imagePath ? `изображение ${imagePath}` : 'изображение (смотрите вопрос на сайте)';
    }
  });
  // Одна фраза и для человека, и для нейросети: что нужно, почему его нет и что делать.
  const onlyText = needs.every((n) => n.kind === 'text');
  return onlyText
    ? '! Для ответа нужен текст к заданию. Если его нет выше, ответ не угадывать, а сверить с текстом.'
    : `! Для ответа нужно: ${parts.join(', ')}. В этом тексте его нет, поэтому ответ не угадывать, а сверить с материалом.`;
}

function sameOptions(gaps: Gap[]): string[] | null {
  if (gaps.length < 2) return null;
  const first = gaps[0].options.join('\u0000');
  return first && gaps.every((g) => g.options.join('\u0000') === first) ? gaps[0].options : null;
}

function formatGaps(q: Question, results: boolean, hints?: Map<Gap, string>): string[] {
  const hint = (g: Gap) => {
    const h = hints?.get(g);
    return h && !(results && g.correct === true) ? ` [${h}]` : '';
  };
  const L: string[] = [];
  const essay = q.gaps.find((g) => g.kind === 'essay');
  const rest = q.gaps.filter((g) => g.kind !== 'essay');
  const numbered = rest.filter((g) => /^\[\d+\]$/.test(g.label));
  const rows = rest.filter((g) => !/^\[\d+\]$/.test(g.label));

  // Соответствие: общие варианты один раз, затем строки.
  const matchRows = rows.filter((g) => g.label !== 'Ответ' && g.label !== 'Единицы' && g.label !== 'Порядок' && g.label !== 'Элементы для перетаскивания');
  if (matchRows.length) {
    const common = sameOptions(matchRows);
    if (common) L.push(`Варианты: ${common.join(' / ')}${common.length > matchRows.length ? ` (лишних: ${common.length - matchRows.length})` : ''}`);
    // Правильный ответ скрыт, но вариантов не так много: исключаем выбранный неверный и занятые верными пунктами.
    const leftover = (g: Gap) => {
      if (!results || !common || g.correct !== false || g.rightAnswer) return '';
      const taken = new Set(matchRows.filter((r) => r.correct === true && r.answer).map((r) => r.answer));
      const left = common.filter((o) => o !== g.answer && !taken.has(o));
      return left.length ? ` (значит, верный — ${left.length === 1 ? left[0] : 'один из: ' + left.join(' / ')})` : '';
    };
    for (const g of matchRows) {
      const opts = common ? '' : ` (${g.options.join(' / ')})`;
      const ans = results ? `${g.answer ?? '—'}${mark(g.correct)}` : '?';
      L.push(`- ${g.label.replace(/\n+/g, ' ')} → ${ans}${opts}${results && g.rightAnswer ? ` (правильно: ${g.rightAnswer})` : ''}${leftover(g)}${hint(g)}`);
    }
  }

  // Пропуски [N]: без результатов текстовые пропуски уже видны в тексте — список не нужен.
  for (const g of numbered) {
    const choice = g.kind !== 'text';
    if (!results && !choice) continue;
    const opts = choice ? g.options.join(' / ') : '';
    if (results) {
      const right = g.rightAnswer && g.correct !== true ? ` → правильно: ${g.rightAnswer}` : '';
      L.push(`${g.label} ${g.answer ?? '—'}${mark(g.correct)}${right}${choice ? `  (${opts})` : ''}${hint(g)}`);
    } else {
      L.push(`${g.label} ${g.kind === 'checkbox' ? 'несколько из: ' : ''}${opts}${hint(g)}`);
    }
  }

  for (const g of rows) {
    if (g.label === 'Ответ') L.push(results ? `Ваш ответ: ${g.answer ?? '—'}${mark(g.correct)}` : 'Ответ: ___');
    else if (g.label === 'Единицы') L.push(`Единицы: ${g.options.join(' / ')}${results && g.answer ? ` (выбрано: ${g.answer})` : ''}`);
    else if (g.label === 'Порядок') L.push(`Расставить по порядку: ${g.options.join(' / ')}`);
    else if (g.label === 'Элементы для перетаскивания') L.push(`Элементы: ${g.options.join(' / ')}`);
  }

  if (essay) {
    if (results && essay.answer) {
      L.push('Ваш ответ (эссе):');
      L.push(essay.answer);
    } else {
      L.push('Ответ: развёрнутый текст (эссе)');
    }
  }
  if (q.attachments.length) L.push(`Файлы ответа: ${q.attachments.join(', ')}`);
  return L;
}

const GENERIC_FEEDBACK = /^Ваш ответ (верный|неправильный|частично правильный)\.?$/i;

export function formatQuestion(q: Question, opts: FormatOptions = {}): string {
  const L: string[] = [];
  const results = !!opts.withResults && !!q.result;
  const imagePath = opts.imagePaths?.get(q.id);
  const [first = '', ...restText] = (q.text || (q.kind === 'info' ? '' : '(текст вопроса не найден)')).split('\n');

  if (q.kind === 'info') {
    L.push('Инфо');
    L.push(first, ...restText);
    if (imagePath) L.push(`(изображение: ${imagePath})`);
    return L.join('\n');
  }

  L.push(`Вопрос ${q.number} [${typeTag(q)}]`);
  L.push(first, ...restText);
  // Отсылка к лекции, которая приложена в конце файла, — уже не пробел в материале.
  const attached = (label: string) => opts.materialTitles?.some((t) => t.toLowerCase().includes(label.toLowerCase())) ?? false;
  const covered = q.needs.filter((n) => n.kind === 'lesson' && attached(n.label));
  const need = needSentence(
    q.needs.filter((n) => !covered.includes(n)),
    imagePath,
  );
  if (need) L.push(need);
  for (const n of covered) L.push(`= Материал «${n.label}» — в конце файла, в разделе «Материал курса».`);
  const known = opts.known?.get(q.id);
  if (known) L.push(known);

  for (const c of q.choices) {
    const body = c.text || (c.hasImage ? '[изображение]' : '');
    let tail = '';
    if (results) {
      if (c.checked) tail = ` (ваш${mark(c.correct)})`;
      else if (c.correct === true) tail = ' (✓)';
    }
    L.push(`${c.label}) ${body}${tail}`);
  }
  L.push(...formatGaps(q, results, opts.hints));
  if (q.kind === 'other' && q.otherText) L.push(`Ответ: ${q.otherText}`);

  if (results && q.result) {
    const r = q.result;
    const outcome = r.outcome ? OUTCOME_RU[r.outcome] : (r.state || '').toLowerCase();
    const grade = r.grade ? `, ${r.grade}` : '';
    if (outcome || grade) L.push(`Итог: ${outcome || '—'}${grade}`);
    if (r.rightAnswer) L.push(`Правильный ответ: ${r.rightAnswer}`);
    else if (q.kind === 'single' && r.outcome === 'incorrect' && !q.choices.some((c) => c.correct === true)) {
      // Правильный ответ скрыт, но выбор сужается: это помогает и при повторной попытке.
      const left = q.choices.filter((c) => !c.checked && c.correct !== false).map((c) => c.label);
      if (left.length) L.push(`Значит, верный — ${left.length === 1 ? left[0] : 'один из: ' + left.join(', ')}`);
    }
    if (r.feedback && !GENERIC_FEEDBACK.test(r.feedback)) L.push(`Отзыв: ${r.feedback}`);
  }
  return L.join('\n');
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function formatDateTime(d: Date): string {
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const nums = (qs: Question[]) => qs.map((q) => '№' + q.number).join(', ');

export function formatDocument(info: DocumentInfo, questions: Question[], opts: FormatOptions = {}): string {
  const real = questions.filter((q) => q.kind !== 'info');
  const byKind: [string, number][] = [
    ['один ответ', real.filter((q) => q.kind === 'single').length],
    ['несколько ответов', real.filter((q) => q.kind === 'multi').length],
    ['выбор/соответствие', real.filter((q) => q.kind === 'match').length],
    ['другие', real.filter((q) => q.kind === 'other').length],
  ];
  const photos = real.filter((q) => q.hasPhoto);
  const media = real.filter((q) => q.needs.some((n) => n.kind === 'video' || n.kind === 'audio' || n.kind === 'media'));
  const material = real.filter((q) => q.needs.length);

  const L: string[] = [];
  L.push(info.meta.quizTitle);
  if (info.meta.course) L.push(`Курс: ${info.meta.course}`);
  if (info.meta.section) L.push(`Тема: ${info.meta.section}`);
  L.push(
    `Вопросов: ${real.length} (${
      byKind
        .filter(([, n]) => n)
        .map(([k, n]) => `${k} — ${n}`)
        .join(', ') || 'нет'
    })`,
  );
  L.push(`Выгружено: ${formatDateTime(info.exportedAt)}, ${info.meta.mode === 'review' ? 'просмотр результатов' : 'попытка'}`);
  L.push(`Ссылка: ${info.meta.url}`);
  if (photos.length) L.push(`С изображением: ${nums(photos)}${opts.imagePaths?.size ? ' (снимки в папке «картинки»)' : ' (смотрите на сайте)'}`);
  if (media.length) L.push(`С видео/аудио: ${nums(media)}`);
  if (info.missingNumbers?.length) {
    L.push(
      `Не собраны: ${info.missingNumbers.map((n) => '№' + n).join(', ')} (всего в тесте ${info.meta.totalQuestions}). Откройте эти страницы теста и выгрузите снова.`,
    );
  }
  if (opts.withResults) {
    const summary = (info.attemptSummary ?? []).filter((r) => /^(Баллы|Оценка)/i.test(r.title));
    if (summary.length) L.push(`Результат: ${summary.map((r) => `${r.title.toLowerCase()} ${r.value}`).join(', ')}`);
    L.push('Обозначения: (ваш) — ваш выбор, ✓ верно, ✗ неверно.');
    if (!info.rightAnswersShown) L.push('Правильные ответы преподаватель не показал: отмечено только, верны ли ваши.');
  }
  if (material.length)
    L.push('Знак «!» отмечает вопросы, для ответа на которые нужен материал вне этого файла: такие ответы не угадывают, а сверяют с материалом.');
  if (opts.known?.size || opts.appendix?.length)
    L.push('Строка «=» и справка в конце — ответы, которые сайт уже подтвердил в прошлых попытках: на них можно опираться.');
  const hints = opts.hints ?? crossReferences(questions);
  const extras = real.some((q) => {
    const rows = q.kind === 'match' ? q.gaps.filter((g) => !/^\[\d+\]$/.test(g.label)) : [];
    const common = sameOptions(rows);
    return !!common && common.length > rows.length;
  });
  if ([...hints.keys()].some((g) => !(opts.withResults && g.correct === true)))
    L.push('Пометка [в вопросе N: «…»] — тот же текст в другом вопросе этого теста, где пропущенное слово видно: сверьте с ней.');
  if (extras) L.push('В соответствии каждый вариант обычно подходит одному пункту; «лишних: N» — варианты, которые не подходят никуда.');
  // Главная причина неверных ответов — общие знания вместо курса; вторая — отказ отвечать на вопрос с опечаткой или склейкой.
  L.push(
    (opts.material?.length
      ? `Ответы сверяйте с ${opts.material.length > 1 ? 'лекциями' : 'лекцией'} курса в конце файла: термины, классификации и цифры в курсе бывают другими, чем в общих источниках.`
      : 'Ответы сверяйте с материалами курса: термины, классификации и цифры в нём бывают другими, чем в общих источниках.') +
      ' Если вопрос оборван или склеен с чужим текстом (так бывает в самих тестах), всё равно выберите самый подходящий вариант и пометьте его как предположение: пустой ответ — 0 баллов.',
  );

  const body = questions.map((q) => formatQuestion(q, { ...opts, hints })).join('\n\n');
  let tail = opts.appendix?.length ? '\n\n' + opts.appendix.join('\n') : '';
  if (opts.material?.length) tail += '\n\n# Материал курса\n\n' + opts.material.join('\n\n');
  return (L.join('\n') + '\n\n' + body + tail + '\n').replace(/\n/g, EOL);
}

/** Текст одного вопроса для буфера обмена — тот же блок, что и в TXT. */
export function formatForClipboard(q: Question, opts: FormatOptions = {}): string {
  return formatQuestion(q, opts);
}

/** Зарезервированные имена устройств Windows: файл с таким именем не создать. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * Безопасное имя файла из названия теста со страницы: без разделителей пути (никакого «../»), управляющих
 * и запрещённых в Windows символов, без точек и пробелов по краям, не длиннее 80 символов, не имя устройства.
 */
export function cleanFileBase(title: string, fallback = 'test'): string {
  // Управляющие символы и невидимые символы направления текста вычищаем намеренно.
  let base = title
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 80)
    .replace(/[. ]+$/g, '');
  if (!base || /^_+$/.test(base)) base = fallback;
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  return base;
}

export function safeFileName(title: string, date: Date, ext: string): string {
  const d = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `${cleanFileBase(title)}_${d}.${ext.replace(/[^a-z0-9]/gi, '') || 'txt'}`;
}

export { mediaPlaceholder };
