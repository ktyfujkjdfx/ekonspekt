/**
 * Перевод фрагмента DOM в аккуратный простой текст:
 * сохраняет абзацы, переносы строк, списки, таблицы, формулы (TeX/alt),
 * заменяет картинки, аудио/видео и внешние виджеты понятными пометками.
 */

const BLOCK = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'FIELDSET',
  'FORM',
  'UL',
  'OL',
  'DL',
  'DT',
  'DD',
  'FIGURE',
  'FIGCAPTION',
  'HR',
  'ADDRESS',
  'CENTER',
  'LEGEND',
]);

const NBSP = String.fromCharCode(0xa0);
/** Граница блока: несколько подряд схлопываются в один перенос строки. */
const BR = String.fromCharCode(1);
/** Начало строки таблицы: внутренние пробелы в ней не схлопываем. */
const PRE = String.fromCharCode(2);

const SKIP_SELECTOR = [
  'style',
  'noscript',
  'template',
  'input[type="hidden"]',
  '.accesshide',
  '.sr-only',
  '.visually-hidden',
  '.visually-hidden-focusable',
  '.MathJax_Preview',
  '.MathJax',
  '.MathJax_Display',
  '.MathJax_SVG',
  '.MJX_Assistive_MathML',
  'mjx-assistive-mml',
  'a.feedbacktrigger',
  '.questioncorrectnessicon',
  '[data-ecx]',
].join(',');

export type MediaKind = 'audio' | 'video' | 'youtube' | 'vimeo' | 'h5p' | 'iframe' | 'widget';

export interface Media {
  kind: MediaKind;
  title: string;
  url: string | null;
}

export interface TextOptions {
  /** Показывать введённые/выбранные значения полей (только для режима результатов). */
  values?: boolean;
  /** Сюда складываются найденные аудио/видео/виджеты. */
  media?: Media[];
}

const MEDIA_LABEL: Record<MediaKind, string> = {
  audio: 'аудио',
  video: 'видео',
  youtube: 'видео YouTube',
  vimeo: 'видео Vimeo',
  h5p: 'интерактивное задание',
  iframe: 'встроенная страница',
  widget: 'внешнее задание',
};

export function mediaPlaceholder(m: Media): string {
  return `[${MEDIA_LABEL[m.kind]}: ${m.title}${m.kind === 'widget' ? ', откройте на странице' : ''}]`;
}

/** Картинка содержательная (не иконка интерфейса, не смайл, не декоративная мелочь). */
export function isContentImage(img: Element): boolean {
  const cls = (img.getAttribute('class') || '').toLowerCase();
  if (/(^|\s)(icon|questioncorrectnessicon|questionflagimage|smiley|emoticon|userpicture|activityicon|logo|texrender)(\s|$)/.test(cls)) return false;
  const src = img.getAttribute('src') || '';
  if (/\/pix\/|\/theme\/image\.php\/|emoticon|\/i\/(grade_|completion)|unflagged|flagged\.svg|\/user\/icon\//.test(src)) return false;
  const w = Number(img.getAttribute('width'));
  const h = Number(img.getAttribute('height'));
  if ((w && w < 32) || (h && h < 32)) return false;
  const el = img as HTMLImageElement;
  if (el.complete && el.naturalWidth > 0 && el.naturalWidth < 32 && el.naturalHeight < 32) return false;
  return true;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function fileName(url: string | null): string {
  if (!url) return '';
  try {
    const p = decodeURIComponent(new URL(url, 'https://e.sfu-kras.ru/').pathname);
    return p.split('/').filter(Boolean).pop() || url;
  } catch {
    return url;
  }
}

/** Описание медиа-элемента (аудио/видео/iframe/виджет) или null. */
export function describeMedia(el: Element): Media | null {
  const tag = el.tagName.toUpperCase();
  if (tag === 'AUDIO' || tag === 'VIDEO') {
    const src = el.getAttribute('src') || el.querySelector('source[src]')?.getAttribute('src') || null;
    const setup = el.getAttribute('data-setup-lazy') || el.getAttribute('data-setup') || '';
    const yt = setup.match(/https?:\\?\/\\?\/(?:www\.)?(?:youtube\.com|youtu\.be)[^"\\]*/);
    if (yt) return { kind: 'youtube', title: yt[0].replace(/\\\//g, '/'), url: yt[0].replace(/\\\//g, '/') };
    const kind = tag === 'AUDIO' ? 'audio' : 'video';
    const title = safeDecode(el.getAttribute('title') || '') || fileName(src) || (kind === 'audio' ? 'аудиозапись' : 'видеозапись');
    return { kind, title, url: src };
  }
  if (tag === 'IFRAME') {
    const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
    if (/youtube\.com|youtu\.be|youtube-nocookie/.test(src)) return { kind: 'youtube', title: src, url: src };
    if (/vimeo\.com/.test(src)) return { kind: 'vimeo', title: src, url: src };
    if (/\/h5p\/|h5p/i.test(src) || /h5p/.test(el.className))
      return { kind: 'h5p', title: el.getAttribute('title') || fileName(src) || 'интерактивное задание', url: src || null };
    let host = src;
    try {
      host = new URL(src, 'https://e.sfu-kras.ru/').host;
    } catch {
      /* как есть */
    }
    return { kind: 'iframe', title: el.getAttribute('title') || host || 'iframe', url: src || null };
  }
  if (tag === 'SCRIPT') {
    const code = (el.getAttribute('src') || '') + ' ' + (el.textContent || '');
    if (/math\/tex/.test(el.getAttribute('type') || '')) return null;
    const host = code.match(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/i)?.[1] || code.match(/['"]([a-z0-9-]+\.(?:com|ru|org|net|io))['"]/i)?.[1];
    return host ? { kind: 'widget', title: host, url: null } : null;
  }
  return null;
}

export function htmlToText(root: Node, opts: TextOptions = {}): string {
  const out: string[] = [];
  walk(root, out, opts);
  return normalize(out.join(''));
}

function pushMedia(m: Media, out: string[], opts: TextOptions) {
  opts.media?.push(m);
  out.push(BR + mediaPlaceholder(m) + BR);
}

function walk(node: Node, out: string[], opts: TextOptions): void {
  if (node.nodeType === 3) {
    out.push(
      (node.nodeValue || '')
        .split(NBSP)
        .join(' ')
        .replace(/[ \t\r\n\f]+/g, ' '),
    );
    return;
  }
  if (node.nodeType !== 1) {
    if (node.nodeType === 9 || node.nodeType === 11) childrenWalk(node, out, opts);
    return;
  }
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (tag === 'SCRIPT') {
    // MathJax 2: исходный TeX в <script type="math/tex">; прочие скрипты — внешние виджеты.
    if (/math\/tex/.test(el.getAttribute('type') || '')) {
      out.push(` \\(${el.textContent}\\) `);
      return;
    }
    const m = describeMedia(el);
    if (m) pushMedia(m, out, opts);
    return;
  }
  // MathJax 3/4 (у контейнера класс MathJax — проверяем до списка пропусков):
  // берём TeX из data-latex, иначе aria-label/доступный текст формулы.
  if (tag === 'MJX-CONTAINER') {
    const latex = el.getAttribute('data-latex') || el.querySelector('[data-latex]')?.getAttribute('data-latex');
    const mml = el.querySelector('mjx-assistive-mml');
    out.push(` ${clean(latex ? `\\(${latex}\\)` : el.getAttribute('aria-label') || mml?.textContent || el.textContent || '')} `);
    return;
  }
  if (el.matches(SKIP_SELECTOR)) return;
  if (el.classList.contains('mediaplugin')) {
    const media = el.querySelector('audio, video, iframe');
    const m = media ? describeMedia(media) : null;
    if (m) {
      pushMedia(m, out, opts);
      return;
    }
  }
  // Код: отступы и переносы сохраняем, оборачиваем в ``` — так его однозначно читают и человек, и нейросеть.
  if (tag === 'PRE' || isMonoBlock(el)) {
    const code = codeText(el);
    if (!code.trim()) return;
    const lines = code.replace(/\s+$/, '').split('\n');
    const first = tag === 'PRE' || !isMonoBlock(el.previousElementSibling);
    const last = tag === 'PRE' || !isMonoBlock(el.nextElementSibling);
    out.push(BR + (first ? PRE + '```' + BR : '') + lines.map((l) => PRE + l).join('\n') + (last ? BR + PRE + '```' : '') + BR);
    return;
  }
  switch (tag) {
    case 'BR':
      out.push('\n');
      return;
    case 'AUDIO':
    case 'VIDEO':
    case 'IFRAME':
    case 'OBJECT':
    case 'EMBED': {
      const m = describeMedia(el) ?? { kind: 'iframe' as const, title: tag.toLowerCase(), url: null };
      pushMedia(m, out, opts);
      return;
    }
    case 'IMG': {
      const img = el as HTMLImageElement;
      const alt = img.getAttribute('alt') || '';
      if (/(^|\s)texrender(\s|$)/.test(img.className)) {
        out.push(img.getAttribute('title') || alt || '[формула]');
        return;
      }
      if (!isContentImage(img)) return;
      out.push('[изображение]');
      return;
    }
    case 'SELECT': {
      const chosen = opts.values ? selectedOptionText(el as HTMLSelectElement) : null;
      out.push(chosen ? `[${chosen}]` : '[ ___ ]');
      return;
    }
    case 'INPUT': {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'text' || t === 'number') {
        const v = opts.values ? (el as HTMLInputElement).value || el.getAttribute('value') || '' : '';
        out.push(v ? `[${v}]` : '[ ___ ]');
      }
      return;
    }
    case 'TEXTAREA':
      out.push(opts.values && (el as HTMLTextAreaElement).value ? (el as HTMLTextAreaElement).value : '[ ___ ]');
      return;
    case 'TABLE':
      out.push(BR + tableToText(el as HTMLTableElement, opts) + BR);
      return;
    case 'LI': {
      const parent = el.parentElement;
      let marker = '• ';
      if (parent && parent.tagName === 'OL') {
        const idx = Array.from(parent.children)
          .filter((c) => c.tagName === 'LI')
          .indexOf(el);
        marker = `${Number(parent.getAttribute('start') || 1) + idx}. `;
      }
      out.push(BR + marker);
      childrenWalk(el, out, opts);
      out.push(BR);
      return;
    }
    case 'SUP':
      out.push('^');
      childrenWalk(el, out, opts);
      return;
    case 'SUB':
      out.push('_');
      childrenWalk(el, out, opts);
      return;
    case 'HR':
      out.push(BR + '----------' + BR);
      return;
  }
  const block = BLOCK.has(tag);
  if (block) out.push(BR);
  childrenWalk(el, out, opts);
  if (block) out.push(BR);
}

const MONO = /font-family:[^;"]*(courier|monospace|consolas|menlo|monaco|lucida console)/i;

/** Абзац, целиком набранный моноширинным шрифтом (так в редакторе Moodle часто вставляют код). */
export function isMonoBlock(el: Element | null): boolean {
  if (!el || (el.tagName !== 'P' && el.tagName !== 'DIV')) return false;
  if (MONO.test(el.getAttribute('style') || '')) return !!clean(el.textContent || '');
  const kids = Array.from(el.children);
  if (!kids.length || el.querySelector('p, div, table, ul, ol, img')) return false;
  const text = clean(el.textContent || '');
  const mono = clean(
    kids
      .filter((k) => MONO.test(k.getAttribute('style') || '') || k.tagName === 'CODE')
      .map((k) => k.textContent || '')
      .join(''),
  );
  return !!text && mono.length >= text.length * 0.9;
}

/** Текст кода как есть: <br> — перенос, неразрывные пробелы — обычные. */
export function codeText(el: Element): string {
  const parts: string[] = [];
  const rec = (n: Node) => {
    if (n.nodeType === 3) {
      parts.push((n.nodeValue || '').split(NBSP).join(' '));
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (e.matches(SKIP_SELECTOR)) return;
    if (e.tagName === 'BR') {
      parts.push('\n');
      return;
    }
    const block = BLOCK.has(e.tagName) || e.tagName === 'LI';
    if (block && parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push('\n');
    e.childNodes.forEach(rec);
    if (block) parts.push('\n');
  };
  el.childNodes.forEach(rec);
  return parts.join('').replace(/\r/g, '').replace(/\t/g, '    ').replace(/^\n+/, '');
}

function childrenWalk(el: Node, out: string[], opts: TextOptions) {
  for (const c of Array.from(el.childNodes)) walk(c, out, opts);
}

export function selectedOptionText(sel: HTMLSelectElement): string | null {
  const opts = Array.from(sel.options);
  const opt = opts.find((o) => o.hasAttribute('selected')) ?? (sel.selectedIndex > 0 ? opts[sel.selectedIndex] : null);
  if (!opt || isPlaceholderOption(opt)) return null;
  return clean(opt.textContent || '') || null;
}

/** «Выберите...», пустой пункт — заглушка выпадающего списка Moodle. */
export function isPlaceholderOption(opt: HTMLOptionElement): boolean {
  const t = clean(opt.textContent || '');
  const v = opt.getAttribute('value');
  return t === '' || v === '' || (/^(выберите|выбрать|choose)/i.test(t) && v === '0');
}

function tableToText(table: HTMLTableElement, opts: TextOptions): string {
  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    if (tr.closest('table') !== table) continue;
    const cells = Array.from(tr.children)
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((c) => htmlToText(c, opts).replace(/\n+/g, ' ').trim());
    if (cells.some(Boolean)) rows.push(cells);
  }
  if (!rows.length) return '';
  // Таблица из одной колонки — просто строки текста.
  if (rows.every((r) => r.filter(Boolean).length <= 1)) return rows.map((r) => r.filter(Boolean).join('')).join('\n');
  const cols = Math.max(...rows.map((r) => r.length));
  // Ширины считаем только по полным строкам; строки с объединёнными ячейками печатаем без выравнивания.
  const full = rows.filter((r) => r.length === cols);
  const widths: number[] = [];
  for (let i = 0; i < cols; i++) widths[i] = Math.min(30, Math.max(0, ...full.map((r) => (r[i] || '').length)));
  return rows
    .map((r) =>
      r.length === cols
        ? PRE +
          '| ' +
          widths
            .map((w, i) => (r[i] || '').padEnd(w))
            .join(' | ')
            .trimEnd() +
          ' |'
        : PRE + '| ' + r.filter(Boolean).join(' | ') + ' |',
    )
    .join('\n');
}

/** Текст элемента без содержимого script/style (заголовки, названия): скрипт в заголовке не попадёт в выгрузку. */
export function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  return clean(c.textContent || '');
}

export function clean(s: string): string {
  return s.split(NBSP).join(' ').replace(/\s+/g, ' ').trim();
}

function normalize(s: string): string {
  return s
    .replace(new RegExp(`[ \\t]*${BR}[\\s${BR}]*`, 'g'), '\n')
    .split('\n')
    .map((l) => (l.startsWith(PRE) ? l.slice(1).trimEnd() : l.replace(/[ \t]+/g, ' ').trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
