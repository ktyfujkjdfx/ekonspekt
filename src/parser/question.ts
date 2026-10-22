import type { Choice, Gap, GapKind, Media, Question, QuestionKind, QuestionResult } from './types';
import { clean, htmlToText, isContentImage, isPlaceholderOption, selectedOptionText } from './text';
import { detectNeeds } from './needs';

/** Названия «прочих» типов Moodle для пометки «[ДРУГОЙ ТИП: …]». */
const TYPE_NAMES: Record<string, string> = {
  shortanswer: 'короткий ответ',
  numerical: 'числовой ответ',
  calculated: 'вычисляемый',
  calculatedsimple: 'простой вычисляемый',
  essay: 'эссе',
  aitext: 'эссе с автопроверкой',
  ddwtos: 'перетаскивание в текст',
  ddimageortext: 'перетаскивание на изображение',
  ddmarker: 'перетаскивание маркеров',
  drawlines: 'соединение линиями на изображении',
  multianswer: 'вложенные ответы',
  ordering: 'упорядочивание',
  gapfill: 'заполнение пропусков',
  wordselect: 'выбор слов в тексте',
  recordrtc: 'аудио/видеозапись ответа',
};

const CHOICE_TYPES = new Set(['multichoice', 'truefalse', 'calculatedmulti', 'multichoiceset', 'oumultiresponse']);
/** Типы, где смысл в картинке и текстом его не передать. */
const IMAGE_TYPES = new Set(['ddimageortext', 'ddmarker', 'drawlines']);

/** Классы .que, которые не являются типом вопроса. */
const NON_TYPE_CLASSES =
  /^(que|deferredfeedback|interactive|interactivecountback|immediatefeedback|adaptive|adaptivenopenalty|deferredcbm|immediatecbm|manualgraded|informationitem|notyetanswered|answersaved|complete|todo|invalidanswer|correct|incorrect|partiallycorrect|notanswered|gaveup|requiresgrading|mangr\w*|graded\w*|flagged|ecx-\S+)$/;

export function getQtype(que: Element): string {
  const classes = Array.from(que.classList);
  const idx = classes.indexOf('que');
  const candidate = idx >= 0 ? classes[idx + 1] : undefined;
  if (candidate && !NON_TYPE_CLASSES.test(candidate)) return candidate;
  return classes.find((c) => !NON_TYPE_CLASSES.test(c)) ?? 'unknown';
}

function isInfo(que: Element): boolean {
  return que.classList.contains('description') || que.classList.contains('informationitem');
}

export function getQuestionNumber(que: Element): string {
  if (isInfo(que)) return 'i';
  const info = que.querySelector('.info');
  const qno = clean(info?.querySelector('.rui-qno, .qno')?.textContent || '');
  if (qno) return /^(инфо|info|i)$/i.test(qno) ? 'i' : qno;
  const head = clean(info?.querySelector('h2, h3, h4, .no')?.textContent || '');
  const m = head.match(/Вопрос\s+(\S+)/i) || head.match(/Question\s+(\S+)/i);
  if (m) return m[1];
  const slot = getSlot(que);
  return slot != null ? String(slot) : '?';
}

function getSlot(que: Element): number | null {
  const m = (que.id || '').match(/^question-\d+-(\d+)$/);
  return m ? Number(m[1]) : null;
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1');
}

// ───────────────────────── верно / неверно ─────────────────────────

/**
 * Верно ли поле: по иконке (title/aria-label «Верно»/«Неверно»/«Частично…»),
 * иначе по классу. Класс ищем и «приклеенным» (в Moodle 5.1+ бывает «mb-1incorrect»).
 */
export function correctnessOf(el: Element | null): boolean | null {
  if (!el) return null;
  const icon = el.querySelector('i.icon[title], i.icon[aria-label], img.questioncorrectnessicon, .text-success, .text-danger, .text-warning');
  const label = (icon?.getAttribute('title') || icon?.getAttribute('aria-label') || icon?.getAttribute('alt') || '').toLowerCase();
  if (label) {
    if (/частично|partial/.test(label)) return false;
    if (/неверно|incorrect/.test(label)) return false;
    if (/верно|correct/.test(label)) return true;
  }
  if (icon?.classList.contains('text-success')) return true;
  if (icon?.classList.contains('text-danger') || icon?.classList.contains('text-warning')) return false;
  const nodes = [el, ...Array.from(el.querySelectorAll('input, select, textarea, td.control'))];
  for (const n of nodes) {
    const m = (n.getAttribute('class') || '').match(/(partiallycorrect|incorrect|correct)(?=\s|$)/);
    if (m) return m[1] === 'correct';
  }
  return null;
}

/** Содержимое поповера Cloze (data-bs-content в 5.x, data-content в 4.x) → строки. */
function popoverLines(scope: Element): string[] {
  const a = scope.querySelector('a.feedbacktrigger, [data-bs-toggle="popover"], [data-toggle="popover"]');
  const html = a?.getAttribute('data-bs-content') || a?.getAttribute('data-content') || '';
  if (!html) return [];
  // Разбираем как текст: <br> → перенос, теги выбрасываем (без innerHTML).
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .split('\n')
    .map(clean)
    .filter(Boolean);
}

const RIGHT_PREFIX = /^\s*(Правильн\S*\s+ответ\S*|Верн\S*\s+ответ\S*|The correct answers?\s+(is|are)|Correct answer)\s*:?\s*/i;

function stripRightPrefix(s: string): string {
  return clean(s.replace(RIGHT_PREFIX, '')).replace(/‑/g, '-');
}

function rightFromLines(lines: string[]): string | null {
  const l = lines.find((x) => RIGHT_PREFIX.test(x));
  return l ? stripRightPrefix(l) || null : null;
}

// ───────────────────────── варианты (radio/checkbox) ─────────────────────────

function choiceText(input: HTMLInputElement, scope: Element): { label: string | null; text: string; hasImage: boolean } {
  const row = input.closest('.answer > *, .form-check, td, li') ?? input.parentElement ?? input;
  const labelId = input.getAttribute('aria-labelledby');
  const labelEl =
    (labelId && scope.querySelector(`[id="${labelId}"]`)) ||
    row.querySelector('[data-region="answer-label"]') ||
    (input.id ? scope.querySelector(`label[for="${cssEscape(input.id)}"]`) : null) ||
    row;
  const numEl = labelEl.querySelector('.answernumber');
  const label = clean(numEl?.textContent || '').replace(/[.)]\s*$/, '') || null;
  const textHost = labelEl.querySelector('.flex-fill') ?? labelEl;
  const clone = textHost.cloneNode(true) as Element;
  clone.querySelectorAll('.answernumber, input, .icon, .feedbackspan, .specificfeedback').forEach((n) => n.remove());
  return { label, text: htmlToText(clone), hasImage: Array.from(textHost.querySelectorAll('img')).some(isContentImage) };
}

function parseChoices(inputs: HTMLInputElement[], scope: Element): Choice[] {
  return inputs.map((input, i) => {
    const row = input.closest('.answer > *') ?? input.parentElement ?? input;
    const { label, text, hasImage } = choiceText(input, scope);
    let correct: boolean | null = null;
    if (row.classList.contains('correct')) correct = true;
    else if (row.classList.contains('incorrect') || row.classList.contains('partiallycorrect')) correct = false;
    return { label: label ?? String.fromCharCode(97 + i), text, hasImage, checked: input.checked || input.hasAttribute('checked'), correct };
  });
}

// ───────────────────────── пропуски / поля ─────────────────────────

function selectOptions(sel: HTMLSelectElement): string[] {
  return Array.from(sel.options)
    .filter((o) => !isPlaceholderOption(o))
    .map((o) => clean(o.textContent || ''))
    .filter(Boolean);
}

/** Поле ответа внутри «пропуска» Cloze / gapselect / shortanswer → Gap. */
function gapFromField(field: Element, label: string): Gap {
  const sel = field.matches('select') ? (field as HTMLSelectElement) : field.querySelector('select');
  const textInput = field.matches('input[type="text"], input:not([type])')
    ? (field as HTMLInputElement)
    : field.querySelector<HTMLInputElement>('input[type="text"], input:not([type]), input[type="number"]');
  const choiceInputs = Array.from(field.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]')).filter(
    (i) => !i.closest('.qtype_multichoice_clearchoice') && i.value !== '-1',
  );
  const lines = popoverLines(field);
  const outcome = field.nextElementSibling?.classList.contains('outcome') ? field.nextElementSibling : null;
  let rightAnswer = rightFromLines(lines);
  if (!rightAnswer && outcome) {
    const r = outcome.querySelector('.rightanswer') ?? outcome;
    const t = htmlToText(r);
    if (RIGHT_PREFIX.test(t)) rightAnswer = stripRightPrefix(t.replace(/\n+/g, '; '));
  }
  let correct = correctnessOf(field);
  if (correct === null && lines.length) {
    if (/^частично|^неверно|^нет ответа/i.test(lines[0])) correct = false;
    else if (/^верно/i.test(lines[0])) correct = true;
  }

  if (sel) {
    return { kind: 'select', label, options: selectOptions(sel), answer: selectedOptionText(sel), correct, rightAnswer };
  }
  if (choiceInputs.length) {
    const kind: GapKind = choiceInputs.some((i) => i.type === 'checkbox') ? 'checkbox' : 'radio';
    const items = choiceInputs.map((i) => ({ ...choiceText(i, field), checked: i.checked || i.hasAttribute('checked') }));
    const answer =
      items
        .filter((x) => x.checked)
        .map((x) => x.text)
        .join('; ') || null;
    return { kind, label, options: items.map((x) => x.text), answer, correct, rightAnswer };
  }
  const value = textInput ? textInput.value || textInput.getAttribute('value') || '' : '';
  return { kind: 'text', label, options: [], answer: value || null, correct, rightAnswer };
}

/** Корневые «пропуски» в формулировке, по порядку документа, без вложенных. */
const CLOZE_GAP_SELECTOR = 'span.subquestion, fieldset.answer, div.answer, table.answer';

function clozeGaps(form: Element): Element[] {
  const all = Array.from(form.querySelectorAll(CLOZE_GAP_SELECTOR));
  return all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
}

function replaceWith(el: Element, text: string) {
  el.replaceWith(el.ownerDocument.createTextNode(text));
}

/** Текст «формулировки» без служебных заголовков, скрытых полей и поповеров. */
function cleanClone(el: Element): Element {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('h4.accesshide, input[type="hidden"], a.feedbacktrigger, .im-controls, .validationerror:empty').forEach((n) => n.remove());
  return clone;
}

// ───────────────────────── основной разбор ─────────────────────────

export function parseQuestion(que: Element, opts: { withResults?: boolean } = {}): Question {
  const qtype = getQtype(que);
  const form = que.querySelector('.formulation') ?? que.querySelector('.content') ?? que;
  const qtextEl = form.querySelector('.qtext');
  const media: Media[] = [];
  const textOpts = { media };
  const gaps: Gap[] = [];
  const choices: Choice[] = [];
  const attachments: string[] = [];
  let otherText: string | null = null;
  let text = '';
  let kind: QuestionKind;

  if (isInfo(que)) {
    kind = 'info';
    text = htmlToText(qtextEl ?? cleanClone(form), textOpts);
  } else if (qtype === 'multianswer' || (!qtextEl && form.querySelector('.subquestion'))) {
    // Cloze: текста .qtext нет, пропуски вставлены прямо в формулировку.
    const clone = cleanClone(form);
    const origGaps = clozeGaps(form);
    const cloneGaps = clozeGaps(clone);
    origGaps.forEach((g, i) => gaps.push(gapFromField(g, `[${i + 1}]`)));
    // Ответ/«Правильный ответ» отдельных пропусков (div.outcome внутри формулировки) из текста убираем.
    clone.querySelectorAll('.outcome').forEach((n) => n.remove());
    cloneGaps.forEach((g, i) => replaceWith(g, ` [${i + 1}] `));
    text = htmlToText(clone, textOpts);
    kind = gaps.length && gaps.every((g) => g.kind !== 'text') ? 'match' : 'other';
  } else {
    const answerArea = form.querySelector('.ablock') ?? form.querySelector(':scope > .answer');
    const choiceInputs = answerArea
      ? Array.from(answerArea.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]')).filter(
          (i) => !i.closest('.qtype_multichoice_clearchoice') && !/_answer-1$/.test(i.id) && !/_unit$/.test(i.name),
        )
      : [];
    const qtextClone = qtextEl ? cleanClone(qtextEl) : null;

    if (CHOICE_TYPES.has(qtype) || (!TYPE_NAMES[qtype] && choiceInputs.length && !form.querySelector('select'))) {
      kind = choiceInputs.some((i) => i.type === 'checkbox') ? 'multi' : 'single';
      choices.push(...parseChoices(choiceInputs, form));
      if (!choices.length) kind = 'other';
    } else if (qtype === 'match' || qtype === 'randomsamatch') {
      kind = 'match';
      for (const tr of Array.from(form.querySelectorAll('table.answer tr'))) {
        const sel = tr.querySelector('select');
        if (!sel) continue;
        const stem = tr.querySelector('td.text');
        gaps.push(gapFromField(tr.querySelector('td.control') ?? sel, stem ? htmlToText(stem, textOpts) : `Строка ${gaps.length + 1}`));
      }
    } else if (qtype === 'gapselect' || (qtextEl && qtextEl.querySelector('select') && !TYPE_NAMES[qtype])) {
      kind = 'match';
      const orig = Array.from(qtextEl!.querySelectorAll('select'));
      orig.forEach((s, i) => gaps.push(gapFromField(s.closest('span.control') ?? s, `[${i + 1}]`)));
      Array.from(qtextClone!.querySelectorAll('select')).forEach((s, i) => replaceWith(s.closest('span.control') ?? s, ` [${i + 1}] `));
    } else if (qtype === 'ddwtos' && qtextEl) {
      kind = 'match';
      parseDdwtos(que, qtextEl, qtextClone!, gaps);
    } else {
      kind = 'other';
      parseOther(qtype, form, qtextEl, qtextClone, answerArea, gaps, attachments, textOpts);
      if (!gaps.length && !attachments.length && qtype !== 'essay') {
        const area = answerArea ? cleanClone(answerArea) : null;
        otherText = area ? htmlToText(area, textOpts) || null : null;
      }
    }
    text = qtextClone ? htmlToText(qtextClone, textOpts) : '';
  }
  // «[4] .» → «[4].»: пропуски вставлены с пробелами по краям.
  text = text.replace(/(\[\d+\]) (?=[.,;:!?)»”"'])/g, '$1').replace(/([(«“]) (\[\d+\])/g, '$1$2');

  const hasPhoto = Array.from(form.querySelectorAll('img')).some((img) => isContentImage(img) && !img.closest('.outcome, .feedback'));
  const result = opts.withResults && kind !== 'info' ? parseResult(que, kind, choices, gaps) : null;

  return {
    id: que.id || '',
    number: getQuestionNumber(que),
    slot: getSlot(que),
    qtype,
    kind,
    typeName: kind === 'other' ? (TYPE_NAMES[qtype] ?? null) : null,
    text,
    choices,
    gaps,
    otherText,
    attachments,
    hasPhoto: hasPhoto || IMAGE_TYPES.has(qtype),
    media: dedupeMedia(media),
    needsScreenshot: IMAGE_TYPES.has(qtype),
    needs: kind === 'info' ? [] : detectNeeds(text, dedupeMedia(media), hasPhoto, IMAGE_TYPES.has(qtype)),
    result,
  };
}

function dedupeMedia(list: Media[]): Media[] {
  const seen = new Set<string>();
  return list.filter((m) => {
    const k = m.kind + (m.url ?? m.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Перетаскивание в текст: пропуски span.drop.placeN, варианты .draghome.choiceK.groupG, ответ — input.placeN = K. */
function parseDdwtos(que: Element, qtextEl: Element, clone: Element, gaps: Gap[]) {
  const choiceText = (group: string, k: string) => {
    const el = que.querySelector(`.draghome.choice${k}.group${group}`);
    return el ? clean(el.textContent || '') : null;
  };
  const groupOptions = (group: string) => {
    const seen = new Set<string>();
    for (const el of Array.from(que.querySelectorAll(`.answercontainer .draghome.group${group}, .draghomes .draghome.group${group}`))) {
      const t = clean(el.textContent || '');
      if (t) seen.add(t);
    }
    return Array.from(seen);
  };
  const drops = Array.from(qtextEl.querySelectorAll('span.drop'));
  drops.forEach((d, i) => {
    const place = Array.from(d.classList).find((c) => /^place\d+$/.test(c)) ?? `place${i + 1}`;
    const group = (Array.from(d.classList).find((c) => /^group\d+$/.test(c)) ?? 'group1').slice(5);
    const input = que.querySelector<HTMLInputElement>(`input.placeinput.${place}`);
    const k = input?.value || input?.getAttribute('value') || '0';
    gaps.push({
      kind: 'drag',
      label: `[${i + 1}]`,
      options: groupOptions(group),
      answer: k !== '0' ? choiceText(group, k) : null,
      correct: correctnessOf(d) ?? (input ? correctnessOf(input.parentElement) : null),
      rightAnswer: null,
    });
  });
  Array.from(clone.querySelectorAll('span.drop')).forEach((d, i) => replaceWith(d, ` [${i + 1}] `));
}

function parseOther(
  qtype: string,
  form: Element,
  qtextEl: Element | null,
  qtextClone: Element | null,
  answerArea: Element | null,
  gaps: Gap[],
  attachments: string[],
  textOpts: { media: Media[] },
) {
  if (qtype === 'essay' || qtype === 'aitext') {
    const resp = form.querySelector('.qtype_essay_response, [class*="_response"]');
    let answer: string | null = null;
    if (resp) {
      if (resp.matches('textarea')) answer = (resp as HTMLTextAreaElement).value || resp.textContent || null;
      else if (resp.querySelector('textarea')) answer = resp.querySelector('textarea')!.value || null;
      else answer = htmlToText(resp, textOpts) || null;
    }
    gaps.push({ kind: 'essay', label: 'Ответ', options: [], answer, correct: null, rightAnswer: null });
    for (const a of Array.from(form.querySelectorAll('.attachments a'))) {
      const t = clean(a.textContent || '');
      if (t) attachments.push(t);
    }
    return;
  }
  if (qtype === 'ordering') {
    const items = Array.from(form.querySelectorAll('.sortablelist li, ul.answer li, ol.answer li'));
    if (items.length) {
      gaps.push({
        kind: 'drag',
        label: 'Порядок',
        options: items.map((li) => clean((li.querySelector('[data-itemcontent]') ?? li).textContent || '')),
        answer: null,
        correct: null,
        rightAnswer: null,
      });
    }
    return;
  }
  if (IMAGE_TYPES.has(qtype)) {
    const labels = Array.from(form.querySelectorAll('.draghome, .marker .markertext'))
      .map((d) => clean(d.textContent || '') || (d.querySelector('img') ? '[изображение]' : ''))
      .filter(Boolean);
    if (labels.length)
      gaps.push({ kind: 'drag', label: 'Элементы для перетаскивания', options: Array.from(new Set(labels)), answer: null, correct: null, rightAnswer: null });
    return;
  }
  // Поля внутри текста вопроса («_____» в shortanswer, gapfill и т.п.).
  if (qtextEl && qtextClone) {
    const inlines = Array.from(qtextEl.querySelectorAll('input[type="text"], input:not([type]), select'));
    const cloneInlines = Array.from(qtextClone.querySelectorAll('input[type="text"], input:not([type]), select'));
    inlines.forEach((f, i) => gaps.push(gapFromField(f.closest('span.answer, span.subquestion, span.control') ?? f, `[${i + 1}]`)));
    cloneInlines.forEach((f, i) => replaceWith(f.closest('span.answer, span.subquestion, span.control') ?? f, ` [${i + 1}] `));
  }
  // Поле «Ответ:» под текстом (shortanswer, numerical, calculated) + единицы измерения.
  if (answerArea) {
    for (const inp of Array.from(answerArea.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type]), input[type="number"]'))) {
      gaps.push(gapFromField(inp.closest('span.answer') ?? inp, 'Ответ'));
    }
    const unitSel = answerArea.querySelector<HTMLSelectElement>('select[name$="_unit"]');
    if (unitSel)
      gaps.push({ kind: 'select', label: 'Единицы', options: selectOptions(unitSel), answer: selectedOptionText(unitSel), correct: null, rightAnswer: null });
    const unitRadios = Array.from(answerArea.querySelectorAll<HTMLInputElement>('input[type="radio"][name$="_unit"]'));
    if (unitRadios.length) {
      const labelOf = (r: HTMLInputElement) => clean(r.closest('label')?.textContent || r.value);
      gaps.push({
        kind: 'radio',
        label: 'Единицы',
        options: unitRadios.map(labelOf),
        answer: unitRadios.filter((r) => r.checked || r.hasAttribute('checked')).map(labelOf)[0] ?? null,
        correct: null,
        rightAnswer: null,
      });
    }
  }
}

// ───────────────────────── результат ─────────────────────────

/** Нормализация для сравнения текста варианта и «Правильный ответ: …». */
function norm(s: string): string {
  return clean(s)
    .toLowerCase()
    .replace(/[.;:,]+$/, '');
}

/**
 * «кот, собака, рыба» → какие варианты это образуют. Перебор с возвратом, длинные тексты первыми:
 * вариант «кот, собака» побеждает «кот». Пустое множество — разложить не удалось.
 */
function splitByChoices(r: string, choices: Choice[]): Set<Choice> {
  const opts = choices
    .map((c) => ({ c, t: norm(c.text) }))
    .filter((x) => x.t)
    .sort((a, b) => b.t.length - a.t.length);
  const used = new Set<Choice>();
  const go = (pos: number): boolean => {
    if (pos >= r.length) return true;
    for (const { c, t } of opts) {
      if (used.has(c) || !r.startsWith(t, pos)) continue;
      const end = pos + t.length;
      if (end !== r.length && !r.startsWith(', ', end)) continue;
      used.add(c);
      if (go(end === r.length ? end : end + 2)) return true;
      used.delete(c);
    }
    return false;
  };
  return go(0) ? used : new Set();
}

function parseResult(que: Element, kind: QuestionKind, choices: Choice[], gaps: Gap[]): QuestionResult {
  const info = que.querySelector('.info');
  const state = clean(info?.querySelector('.state')?.textContent || '') || null;
  const gradeRaw = clean(info?.querySelector('.grade')?.textContent || '');
  const grade = /из|out of/i.test(gradeRaw) ? gradeRaw.replace(/^[^:]*:\s*/, '') : null;

  // Только итоговый блок вопроса (у Cloze внутри формулировки есть .outcome отдельных пропусков).
  const outcomeEl = que.querySelector('.content > .outcome') ?? Array.from(que.querySelectorAll('.outcome')).find((o) => !o.closest('.formulation')) ?? null;
  const rightEl = outcomeEl?.querySelector('.rightanswer');
  const rightAnswer = rightEl ? stripRightPrefix(htmlToText(rightEl).replace(/\n+/g, '; ')) || null : null;
  const fbEls = outcomeEl ? Array.from(outcomeEl.querySelectorAll('.specificfeedback, .generalfeedback, .numpartscorrect')) : [];
  const feedback =
    fbEls
      .map((e) => clean(htmlToText(e)))
      .filter(Boolean)
      .join(' ') || null;

  let outcome: QuestionResult['outcome'] = null;
  if (que.classList.contains('partiallycorrect')) outcome = 'partial';
  else if (que.classList.contains('incorrect') || que.classList.contains('notanswered')) outcome = 'incorrect';
  else if (que.classList.contains('correct')) outcome = 'correct';
  if (!outcome && grade) {
    const m = grade.match(/([\d.,]+)\s*(?:из|out of)\s*([\d.,]+)/i);
    if (m) {
      const got = Number(m[1].replace(',', '.'));
      const max = Number(m[2].replace(',', '.'));
      if (max > 0) outcome = got >= max ? 'correct' : got <= 0 ? 'incorrect' : 'partial';
    }
  }
  if (!outcome && feedback) {
    if (/частично/i.test(feedback)) outcome = 'partial';
    else if (/неверн|неправильн|incorrect/i.test(feedback)) outcome = 'incorrect';
    else if (/верн|правильн|correct/i.test(feedback)) outcome = 'correct';
  }

  // Правильные варианты: строку «Правильные ответы: a, b» раскладываем на целые тексты вариантов
  // (в самих вариантах бывают запятые, поэтому не режем по «, »).
  if (rightAnswer && (kind === 'single' || kind === 'multi')) {
    const right =
      kind === 'single' ? new Set(choices.filter((c) => norm(c.text) === norm(rightAnswer)).map((c) => c)) : splitByChoices(norm(rightAnswer), choices);
    if (right.size) for (const c of choices) c.correct = right.has(c);
  } else if (kind === 'single' && choices.some((c) => c.checked && c.correct === true)) {
    for (const c of choices) if (c.correct === null) c.correct = false;
  } else if (kind === 'single' && outcome === 'correct') {
    // Правильность скрыта, но балл максимальный — значит, отмеченный вариант верный.
    for (const c of choices) c.correct = c.checked;
  } else if (kind === 'multi' && outcome === 'correct') {
    for (const c of choices) c.correct = c.checked;
  }

  // Правильность по полям скрыта, но итог однозначен: полный балл — всё верно, ноль — всё неверно.
  if (outcome === 'correct' || (outcome === 'incorrect' && grade)) {
    for (const g of gaps) if (g.correct === null && g.kind !== 'essay' && g.answer !== null) g.correct = outcome === 'correct';
    if (outcome === 'incorrect') for (const c of choices) if (c.checked && c.correct === null) c.correct = false;
  }

  return { state, grade, outcome, rightAnswer, feedback };
}
