import { parseQuestion } from '../parser/question';
import { getQuestionElements } from '../parser/page';
import { formatForClipboard, typeShort } from '../format/txt';
import GLYPH_B64 from '../../icons/glyph.svg';
import { FEATURES } from '../shared/features';
import { contentImages, copyWithImage, mediaNote, type CardSource } from './copyImage';
import type { Need } from '../parser/needs';

const GLYPH = `data:image/svg+xml;base64,${GLYPH_B64}`;

declare const __E2E__: boolean;
/**
 * Закрытый Shadow DOM: скрипты страницы не доберутся до наших кнопок (не подменят подпись, не нажмут их).
 * Открытый — только в тестовой сборке, чтобы автотесты могли нажимать кнопки.
 */
const SHADOW_MODE: ShadowRootMode = typeof __E2E__ !== 'undefined' && __E2E__ ? 'open' : 'closed';

/**
 * Кнопка «Копировать», пометка типа и предупреждение про фото рядом с «Отметить вопрос».
 * Разметка изолирована в Shadow DOM, хост помечен data-ecx (его пропускают парсер и скриншоты).
 */

/**
 * Дизайн на странице — сдержанный: шрифт Moodle (Roboto), песочные полутона, панель приглушена
 * и проявляется, когда курсор над вопросом. Цвет иконки следует теме страницы (currentColor + маска).
 */
const CSS = `
:host {
  all: initial; display: block; flex: 1 1 100%; width: 100%; margin: 6px 0 10px;
  font: 500 12px/1.4 Roboto, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  --ink: #1d2a40; --muted: #7a8494; --line: rgba(32, 52, 92, .18); --tint: rgba(138, 166, 230, .14); --chip: #ffffff;
  --accent: #2f4f8f; --ok: #3f8a5e; --ok-tint: rgba(63, 138, 94, .1);
  --photo: #c9584c; --photo-tint: rgba(208, 101, 90, .08); --media: #b9772e; --media-tint: rgba(233, 161, 91, .12);
  --ease: cubic-bezier(.22, .8, .2, 1); --spring: cubic-bezier(.34, 1.45, .55, 1);
}
/* В строке «Выполнен · Баллы» (тема Moove): компактно, рядом с пилюлями Moodle. */
:host([data-inline]) { display: block; width: auto; flex: 0 0 auto; margin: 6px 0 6px 2px; }
:host([data-inline]) .row { flex-wrap: nowrap; }
:host([data-notes]) { margin: 0 0 8px; }
.row.notes-row { opacity: 1; }
:host([data-theme="dark"]) {
  --ink: #e9edf4; --muted: #97a1b0; --line: rgba(220, 230, 250, .18); --tint: rgba(169, 192, 242, .12); --chip: rgba(255, 255, 255, .04);
  --accent: #a9c0f2; --ok: #8ccfa3; --ok-tint: rgba(140, 207, 163, .12);
  --photo: #f0a094; --photo-tint: rgba(240, 160, 148, .1); --media: #f0c08a; --media-tint: rgba(240, 192, 138, .1);
}
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; opacity: .62; transition: opacity .35s var(--ease); }
:host([data-active]) .row, :host(:hover) .row, .row:focus-within, :host([data-done]) .row { opacity: 1; }
button {
  all: unset; box-sizing: border-box; position: relative; cursor: pointer;
  display: inline-grid; grid-template-columns: 14px auto; align-items: center; column-gap: 6px;
  height: 28px; padding: 0 11px 0 9px; border-radius: 999px; color: var(--ink); background: var(--chip);
  box-shadow: inset 0 0 0 1px var(--line);
  transition: background .25s var(--ease), box-shadow .25s var(--ease), color .25s var(--ease), transform .3s var(--spring);
}
button:hover { background: var(--tint); box-shadow: inset 0 0 0 1px var(--accent); }
button:active { transform: scale(.96); transition-duration: .1s; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ico { position: relative; width: 14px; height: 14px; }
.ico > * { position: absolute; inset: 0; transition: opacity .25s var(--ease), transform .4s var(--spring); }
.glyph { background: currentColor; -webkit-mask: var(--glyph) center / contain no-repeat; mask: var(--glyph) center / contain no-repeat; }
.check { opacity: 0; transform: scale(.4) rotate(-12deg); }
.check svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.check path { stroke-dasharray: 20; stroke-dashoffset: 20; transition: stroke-dashoffset .45s var(--ease) .05s; }
/* Подписи наложены друг на друга — ширина кнопки не прыгает. */
.labels { display: grid; }
.labels > span { grid-area: 1 / 1; font-weight: 600; letter-spacing: .005em; transition: opacity .25s var(--ease), transform .35s var(--ease); }
.labels .l-done, .labels .l-fail { opacity: 0; transform: translateY(4px); }
button.done { color: var(--ok); background: var(--ok-tint); box-shadow: inset 0 0 0 1px transparent; }
button.done .glyph { opacity: 0; transform: scale(.5); }
button.done .check { opacity: 1; transform: none; }
button.done .check path { stroke-dashoffset: 0; }
button.done .l-idle, button.fail .l-idle { opacity: 0; transform: translateY(-4px); }
button.done .l-done { opacity: 1; transform: none; }
button.fail { color: var(--photo); }
button.fail .l-fail { opacity: 1; transform: none; }
button.busy { cursor: progress; }
button.busy .glyph { animation: ecx-pulse 1s ease-in-out infinite; }
@keyframes ecx-pulse { 50% { opacity: .35; } }
.badge { font-size: 10px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); }
.notes { display: contents; }
.note { display: inline-flex; align-items: center; gap: 7px; padding: 3px 9px 3px 8px; border-radius: 7px; font-size: 11.5px; font-weight: 500; }
.note::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex: none; }
.photo { color: var(--photo); background: var(--photo-tint); }
.media { color: var(--media); background: var(--media-tint); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) { *, *::before { transition-duration: .01ms !important; } }
`;

/** Маленький помощник: элементы строим без innerHTML (требование ревью AMO). */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

function styleEl(css: string): HTMLStyleElement {
  return h('style', {}, css);
}

const NS = 'http://www.w3.org/2000/svg';

function svgCheck(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M3.5 8.5 6.5 11.5 12.5 4.5');
  svg.append(path);
  return svg;
}

/** Кнопка в стиле панели: значок, подпись и подписи результата (наложены — ширина не прыгает). */
function makeButton(idle: string, title: string, done = 'Скопировано', extraClass = ''): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: ('copy ' + extraClass).trim(), title },
    h('span', { class: 'ico', 'aria-hidden': 'true' }, h('span', { class: 'glyph' }), h('span', { class: 'check' }, svgCheck())),
    h(
      'span',
      { class: 'labels' },
      h('span', { class: 'l-idle' }, idle),
      h('span', { class: 'l-done', 'aria-hidden': 'true' }, done),
      h('span', { class: 'l-fail', 'aria-hidden': 'true' }, 'Не вышло'),
    ),
  );
}

/** Показать результат на кнопке на 1,8 с. «busy» — пока делается снимок. */
function flash(button: HTMLButtonElement, host: HTMLElement, status: HTMLElement, state: 'busy' | 'done' | 'fail', message: string): void {
  const b = button as HTMLButtonElement & { _t?: ReturnType<typeof setTimeout> };
  clearTimeout(b._t);
  button.classList.remove('done', 'fail', 'busy');
  void button.offsetWidth; // перезапуск перехода при повторном клике
  button.classList.add(state);
  host.setAttribute('data-done', '');
  status.textContent = message;
  if (state === 'busy') return;
  b._t = setTimeout(() => {
    button.classList.remove('done', 'fail');
    host.removeAttribute('data-done');
    status.textContent = '';
  }, 1800);
}

/** Без пометки «нужно изображение»: на картинке оно будет. */
export function withoutImageNeed<T extends { needs: Need[] }>(x: T): T {
  return { ...x, needs: x.needs.filter((n) => n.kind !== 'image') };
}

export function noteFor(needs: Need[]): string | undefined {
  return mediaNote(needs.map((n) => (n.kind === 'media' ? 'other' : n.kind)));
}

/** Вторая кнопка «С картинкой»: одна картинка — текст вопроса и рисунок на своём месте. */
function imageButton(host: HTMLElement, status: HTMLElement, getSource: () => CardSource | Promise<CardSource>): HTMLButtonElement {
  const btn = makeButton(
    'С картинкой',
    'Скопировать вопрос одной картинкой: текст, варианты и рисунок. Вставляется в чат с нейросетью (ChatGPT, Claude, Gemini, Qwen) и в Word по Ctrl+V',
    'Скопировано',
    'img',
  );
  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (btn.classList.contains('busy')) return;
    flash(btn, host, status, 'busy', 'Делаю снимок вопроса…');
    const r = await copyWithImage(await getSource());
    flash(
      btn,
      host,
      status,
      r === 'fail' ? 'fail' : 'done',
      r === 'image' ? 'Вопрос скопирован картинкой' : r === 'text' ? 'Картинку скопировать не вышло — скопирован текст' : 'Не удалось скопировать',
    );
  });
  return btn;
}

export interface UiContext {
  withResults: () => boolean;
}

function pageTheme(): 'dark' | 'light' {
  const t = document.body?.getAttribute('data-bs-theme') || document.documentElement.getAttribute('data-bs-theme');
  return t === 'dark' ? 'dark' : 'light';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    Object.assign(ta.style, { position: 'fixed', top: '-1000px', opacity: '0' });
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function newHost(): HTMLElement {
  const host = document.createElement('ecx-panel');
  host.setAttribute('data-ecx', '');
  host.setAttribute('data-theme', pageTheme());
  host.style.setProperty('--glyph', `url("${GLYPH}")`);
  return host;
}

/** Пометки «фото» / «аудио-видео» отдельной строкой (или null, если пометок нет). */
function buildNotes(q: ReturnType<typeof parseQuestion>): HTMLElement | null {
  const notes: HTMLElement[] = [];
  if (q.needsScreenshot) notes.push(h('span', { class: 'note photo' }, 'Задание на изображении — приложите скриншот'));
  else if (q.hasPhoto) notes.push(h('span', { class: 'note photo' }, 'В вопросе есть фото — прикрепите его отдельно'));
  if (q.media.length) {
    const kinds = new Set(
      q.media.map((m) => (m.kind === 'audio' ? 'аудио' : m.kind === 'widget' || m.kind === 'iframe' || m.kind === 'h5p' ? 'интерактивное задание' : 'видео')),
    );
    notes.push(h('span', { class: 'note media' }, `Есть ${Array.from(kinds).join(' и ')} — в текст не копируется, смотрите на странице`));
  }
  if (!notes.length) return null;
  const host = newHost();
  host.setAttribute('data-notes', '');
  host.attachShadow({ mode: SHADOW_MODE }).append(styleEl(CSS), h('div', { class: 'row notes-row' }, ...notes));
  return host;
}

function buildHost(que: Element, ctx: UiContext, q: ReturnType<typeof parseQuestion>): HTMLElement {
  const host = newHost();
  const root = host.attachShadow({ mode: SHADOW_MODE });
  const button = makeButton('Копировать', 'Скопировать вопрос с вариантами в буфер обмена');
  const status = h('span', { class: 'sr', role: 'status', 'aria-live': 'polite' });
  const row = h('div', { class: 'row' }, button);
  const text = () => {
    const fresh = parseQuestion(que, { withResults: ctx.withResults() });
    return formatForClipboard(fresh, { withResults: ctx.withResults() });
  };
  if (FEATURES.copyWithImage && (q.hasPhoto || q.needsScreenshot)) {
    row.append(
      imageButton(host, status, () => {
        const fresh = parseQuestion(que, { withResults: ctx.withResults() });
        return {
          text: formatForClipboard(withoutImageNeed(fresh), { withResults: ctx.withResults() }),
          images: fresh.needsScreenshot ? [] : contentImages(que),
          snapshot: fresh.needsScreenshot ? que : undefined,
          note: noteFor(fresh.needs),
        };
      }),
    );
  }
  row.append(h('span', { class: 'badge' }, typeShort(q)), status);
  root.append(styleEl(CSS), row);

  // Панель проявляется, когда курсор над вопросом.
  que.addEventListener('mouseenter', () => host.setAttribute('data-active', ''));
  que.addEventListener('mouseleave', () => host.removeAttribute('data-active'));

  button.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const ok = await copyText(text());
    flash(button, host, status, ok ? 'done' : 'fail', ok ? 'Вопрос скопирован' : 'Не удалось скопировать');
  });
  return host;
}

/**
 * Кнопка «Копировать …» с пометкой справа — для страниц лекции и блоков кода.
 * Текст берётся в момент нажатия (getText), чтобы попадало актуальное состояние страницы.
 * withImage — вторая кнопка «С картинкой» (снимок элемента getEl).
 */
export function copyChip(opts: {
  label: string;
  doneLabel?: string;
  title: string;
  badge?: string;
  compact?: boolean;
  getText: () => string | Promise<string>;
  withImage?: () => CardSource | Promise<CardSource>;
}): HTMLElement {
  const host = newHost();
  if (opts.compact) host.setAttribute('data-compact', '');
  const root = host.attachShadow({ mode: SHADOW_MODE });
  const button = makeButton(opts.label, opts.title, opts.doneLabel);
  const status = h('span', { class: 'sr', role: 'status', 'aria-live': 'polite' });
  const row = h('div', { class: 'row' }, button);
  if (FEATURES.copyWithImage && opts.withImage) row.append(imageButton(host, status, opts.withImage));
  if (opts.badge) row.append(h('span', { class: 'badge' }, opts.badge));
  row.append(status);
  root.append(
    styleEl(
      CSS +
        `
    :host([data-compact]) { margin: 4px 0 2px; }
    :host([data-compact]) .row { justify-content: flex-end; }
    :host([data-compact]) button { height: 24px; padding: 0 9px 0 8px; font-size: 11.5px; }`,
    ),
    row,
  );

  button.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    let ok = false;
    try {
      ok = await copyText(await opts.getText());
    } catch {
      ok = false;
    }
    flash(button, host, status, ok ? 'done' : 'fail', ok ? 'Скопировано' : 'Не удалось скопировать');
  });
  return host;
}

function hasHost(que: Element): boolean {
  return !!que.querySelector(':scope > .info [data-ecx], :scope [data-ecx]');
}

export function injectButtons(ctx: UiContext): void {
  // Сначала только читаем (разметку и стили всех вопросов), потом только вставляем.
  // Иначе каждое чтение стиля после вставки заставляет браузер пересчитывать раскладку — на 120 вопросах это заметно.
  type Plan = { que: Element; info: Element; q: ReturnType<typeof parseQuestion>; mode: 'line' | 'pills' | 'info'; pills?: Element; line?: Element };
  const plans: Plan[] = [];
  for (const que of getQuestionElements(document)) {
    if (hasHost(que)) continue;
    const info = que.querySelector('.info');
    if (!info) continue;
    // Тема Moove: состояние и баллы — пилюли в flex-строке. Встаём в эту строку: компактно и
    // в стороне от «Отметить вопрос». Иначе (Boost и др.) — отдельной строкой в шапке.
    const pill = info.querySelector('.grade') ?? info.querySelector('.state');
    const pills = pill?.parentElement ?? undefined;
    const line = pills?.parentElement ?? undefined;
    let mode: Plan['mode'] = 'info';
    if (pills && line && pills !== info && line !== info && /flex/.test(getComputedStyle(line).display)) mode = 'line';
    else if (pills && pills !== info && /flex/.test(getComputedStyle(pills).display)) mode = 'pills';
    plans.push({ que, info, q: parseQuestion(que), mode, pills, line });
  }
  for (const { que, info, q, mode, pills, line } of plans) {
    const host = buildHost(que, ctx, q);
    const notes = buildNotes(q);
    if (mode === 'line') {
      // Moove: «Вопрос N» (на всю ширину) и строка пилюль — элементы общей flex-строки. Встаём сразу за пилюлями.
      host.setAttribute('data-inline', '');
      pills!.after(host);
      if (notes) line!.after(notes); // пометки — своей строкой под шапкой, на всю ширину
    } else if (mode === 'pills') {
      host.setAttribute('data-inline', '');
      pills!.appendChild(host);
      if (notes) pills!.after(notes);
    } else {
      info.appendChild(host);
      if (notes) info.appendChild(notes);
    }
  }
}

export function removeButtons(): void {
  document.querySelectorAll('.que [data-ecx]').forEach((n) => n.remove());
}

export function syncTheme(): void {
  const t = pageTheme();
  document.querySelectorAll<HTMLElement>('ecx-panel[data-ecx]').forEach((h) => h.setAttribute('data-theme', t));
}

/** Следим за перерисовкой страницы и сменой темы; кнопки не дублируются. */
export function observe(enabled: () => boolean, ctx: UiContext): void {
  let scheduled = false;
  const run = () => {
    scheduled = false;
    if (enabled()) injectButtons(ctx);
  };
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        syncTheme();
        continue;
      }
      if (!scheduled && Array.from(m.addedNodes).some((n) => n instanceof Element && !n.hasAttribute('data-ecx') && !n.hasAttribute('data-ecx-render'))) {
        scheduled = true;
        requestAnimationFrame(run);
      }
    }
  });
  const target = document.querySelector('#region-main, [role="main"]') ?? document.body;
  mo.observe(target, { childList: true, subtree: true });
  mo.observe(document.body, { attributes: true, attributeFilter: ['data-bs-theme', 'class'] });
}

/** Оверлей прогресса выгрузки (на случай, если popup закрыт). */
export class ProgressOverlay {
  private host: HTMLElement;
  private text: HTMLElement;
  private bar: HTMLElement;
  private hideTimer?: ReturnType<typeof setTimeout>;
  /** Полоска только растёт: внутренний порядок загрузки пользователю не виден. */
  private pct = 0;

  constructor() {
    this.host = document.createElement('ecx-panel');
    this.host.setAttribute('data-ecx', '');
    this.host.setAttribute('data-theme', pageTheme());
    Object.assign(this.host.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647' });
    this.host.style.setProperty('--glyph', `url("${GLYPH}")`);
    const root = this.host.attachShadow({ mode: SHADOW_MODE });
    this.text = h('div', { class: 'text' });
    this.bar = h('div', { class: 'fill' });
    this.box = h(
      'div',
      { class: 'box' },
      h('div', { class: 'head' }, h('span', { class: 'glyph mark', 'aria-hidden': 'true' }), h('span', { class: 'title' }, 'Выгрузка вопросов')),
      this.text,
      h('div', { class: 'track' }, this.bar),
    );
    root.append(
      styleEl(
        CSS +
          `
      :host { width: auto; flex: none; margin: 0; }
      :host { --card: #ffffff; --shadow: 0 1px 0 rgba(255,255,255,.7) inset, 0 2px 6px rgba(29,42,64,.08), 0 18px 40px -18px rgba(29,42,64,.35); }
      :host([data-theme="dark"]) { --card: #262a31; --shadow: 0 1px 0 rgba(255,240,220,.05) inset, 0 2px 6px rgba(0,0,0,.4), 0 18px 40px -18px rgba(0,0,0,.9); }
      .box { width: 280px; background: var(--card); color: var(--ink); border-radius: 14px; padding: 12px 14px 13px;
        box-shadow: var(--shadow), inset 0 0 0 1px var(--line);
        opacity: 0; transform: translateY(10px) scale(.98); transition: opacity .35s var(--ease), transform .45s var(--spring); }
      .box.on { opacity: 1; transform: none; }
      .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
      .mark { width: 13px; height: 13px; flex: none; color: var(--accent); }
      .title { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
      .text { font-size: 12.5px; line-height: 1.4; }
      .text.err { color: var(--photo); }
      .track { height: 3px; border-radius: 3px; background: var(--line); margin-top: 10px; overflow: hidden; }
      .fill { height: 100%; width: 0; border-radius: inherit; background: var(--accent); transition: width .45s var(--ease); }`,
      ),
      this.box,
    );
  }

  private box: HTMLElement;

  show(text: string, done?: number, total?: number, isError = false): void {
    clearTimeout(this.hideTimer);
    this.host.setAttribute('data-theme', pageTheme());
    if (!this.host.isConnected) {
      document.body.appendChild(this.host);
      requestAnimationFrame(() => requestAnimationFrame(() => this.box.classList.add('on')));
    } else {
      this.box.classList.add('on');
    }
    this.text.textContent = text;
    this.text.className = 'text' + (isError ? ' err' : '');
    if (isError) {
      this.pct = 0;
      this.bar.style.width = '0';
      return;
    }
    if (total) this.pct = Math.max(this.pct, Math.round(((done ?? 0) / total) * 100));
    this.bar.style.width = `${Math.max(this.pct, 4)}%`;
  }

  /** Новая выгрузка — полоска с нуля. */
  begin(): void {
    this.pct = 0;
  }

  hide(delay = 0): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.box.classList.remove('on');
      this.hideTimer = setTimeout(() => this.host.remove(), 450);
    }, delay);
  }
}
