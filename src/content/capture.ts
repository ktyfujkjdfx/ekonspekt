import { toPng } from 'html-to-image';
import { neutralize } from '../shared/sanitize';

/**
 * PNG блока вопроса: рендер DOM в canvas (html-to-image), без captureVisibleTab.
 * Блок клонируется в скрытый контейнер фиксированной ширины на текущей странице —
 * там уже загружены стили Moodle, поэтому вид совпадает со страницей и не зависит от Ctrl +/−.
 */

const RENDER_WIDTH = 860;
const PIXEL_RATIO = 2;
/** Безопасный предел высоты canvas в браузерах. */
const MAX_CANVAS_PX = 16000;
const IMG_TIMEOUT_MS = 15000;

let container: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (container && container.isConnected) return container;
  container = document.createElement('div');
  container.setAttribute('data-ecx-render', '');
  container.setAttribute('data-bs-theme', 'light');
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, {
    position: 'absolute',
    left: '-20000px',
    top: '0',
    width: `${RENDER_WIDTH}px`,
    background: '#ffffff',
    color: '#1d2125',
    pointerEvents: 'none',
    zIndex: '-1',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(container);
  return container;
}

export function disposeRenderContainer(): void {
  container?.remove();
  container = null;
}

function waitImage(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) return img.decode().catch(() => {});
  return new Promise((resolve) => {
    const t = setTimeout(resolve, IMG_TIMEOUT_MS);
    const done = () => {
      clearTimeout(t);
      resolve();
    };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  });
}

/** Картинки same-origin (загружены страницей с её cookie) → data URL, чтобы рендер не делал своих запросов. */
function inlineImage(img: HTMLImageElement): void {
  if (!img.naturalWidth || img.src.startsWith('data:')) return;
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    img.src = c.toDataURL('image/png');
  } catch {
    /* чужой домен — оставляем как есть */
  }
}

/** Серая рамка с подписью на месте картинки, которую нельзя встроить без стороннего запроса. */
function placeholder(img: HTMLImageElement): void {
  const w = Math.min(img.naturalWidth || Number(img.getAttribute('width')) || 320, 640);
  const h = Math.min(img.naturalHeight || Number(img.getAttribute('height')) || 160, 480);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f1f3f7" stroke="#c9ced8"/>` +
    `<text x="50%" y="50%" font-family="Arial" font-size="14" fill="#6e798b" text-anchor="middle">изображение с другого сайта — смотрите на странице</text></svg>`;
  img.src = `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(svg)))}`;
}

function prepareClone(el: Element): HTMLElement {
  const clone = (el.ownerDocument === document ? el.cloneNode(true) : document.importNode(el, true)) as HTMLElement;
  clone.querySelectorAll('[data-ecx], .questionflag').forEach((n) => n.remove());
  // Копия попадает в документ страницы — сначала убираем из неё всё исполняемое.
  neutralize(clone);
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((n) => n.setAttribute('id', 'ecx-' + n.id));
  clone.querySelectorAll('img').forEach((img) => {
    img.removeAttribute('loading');
    img.removeAttribute('srcset');
  });
  // Иконки верно/неверно рисуются шрифтом FontAwesome, который может не встроиться в картинку, — заменяем символами.
  clone.querySelectorAll('i.icon[title], i.icon[aria-label]').forEach((icon) => {
    const label = (icon.getAttribute('title') || icon.getAttribute('aria-label') || '').toLowerCase();
    const [sym, color] = /частично/.test(label)
      ? ['◐', '#b26a00']
      : /неверно/.test(label)
        ? ['✗', '#c62828']
        : /верно/.test(label)
          ? ['✓', '#1a7f37']
          : ['', ''];
    if (!sym) return;
    const span = document.createElement('span');
    span.textContent = sym;
    Object.assign(span.style, { color, fontWeight: '700', margin: '0 4px' });
    icon.replaceWith(span);
  });
  // Поля вокруг вопроса: снимок не прилипает к краям.
  Object.assign(clone.style, { margin: '0', padding: '20px 24px', background: '#ffffff', boxSizing: 'border-box' });
  return clone;
}

export async function captureQuestion(el: Element): Promise<Uint8Array> {
  const host = getContainer();
  const clone = prepareClone(el);
  host.replaceChildren(clone);
  try {
    const imgs = Array.from(clone.querySelectorAll('img'));
    await Promise.all(imgs.map(waitImage));
    imgs.forEach(inlineImage);
    // Картинку с чужого сайта не встроить без запроса туда — ставим понятную заглушку вместо неё.
    imgs.forEach((img) => {
      if (!img.src.startsWith('data:')) placeholder(img);
    });
    await Promise.all(imgs.map(waitImage));

    const height = Math.ceil(clone.scrollHeight);
    // Очень длинный вопрос (текст на несколько экранов): уменьшаем чёткость, но не теряем картинку.
    const ratio = Math.max(0.5, Math.min(PIXEL_RATIO, MAX_CANVAS_PX / Math.max(1, height)));
    const base = {
      // Шрифты не вшиваем: иначе библиотека подгрузила бы их с CDN темы (Google Fonts). Снимок — системным шрифтом.
      skipFonts: true,
      pixelRatio: ratio,
      backgroundColor: '#ffffff',
      width: RENDER_WIDTH,
      style: { margin: '0' },
      filter: (n: HTMLElement) => !(n instanceof Element && n.hasAttribute('data-ecx')),
    };
    let dataUrl: string;
    try {
      dataUrl = await toPng(clone, base);
    } catch {
      // Шрифты с чужих доменов иногда не встраиваются — пробуем без них.
      dataUrl = await toPng(clone, { ...base, skipFonts: true });
    }
    return dataUrlToBytes(dataUrl);
  } finally {
    host.replaceChildren();
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** На время съёмки переключаем тему Moove на светлую (фон картинок — белый). */
export async function withLightTheme<T>(fn: () => Promise<T>): Promise<T> {
  const body = document.body;
  const prev = body.getAttribute('data-bs-theme');
  if (prev !== 'dark') return fn();
  body.setAttribute('data-bs-theme', 'light');
  try {
    return await fn();
  } finally {
    body.setAttribute('data-bs-theme', prev);
  }
}
