import { captureQuestion, disposeRenderContainer, withLightTheme } from './capture';
import { isContentImage } from '../parser/text';
import { neutralize } from '../shared/sanitize';
import { copyText } from './ui';

/**
 * «С картинкой» — одна кнопка, одна вставка: в буфер кладём ОДНУ картинку, на которой и текст вопроса
 * (тот же, что даёт «Копировать»: формулировка, варианты, пометки «!», пример из лекции),
 * и сам рисунок — на своём месте в тексте.
 *
 * Почему одной картинкой: чаты читают буфер по-разному. Если положить текст и картинку рядом, ChatGPT вставит
 * только текст, Claude — только картинку. Одну картинку одинаково прикрепляют ChatGPT, Claude, Gemini, Qwen,
 * её вставляют Word и Google Docs. Текстом (для Блокнота) — обычная «Копировать».
 *
 * Снимок делается дольше клика, поэтому в ClipboardItem передаём обещание (Promise<Blob>):
 * так браузер не теряет разрешение на запись, полученное от нажатия.
 */

export type CopyImageResult = 'image' | 'text' | 'fail';

export interface CardSource {
  /** Текст вопроса для карточки (без строки «! … изображение»: рисунок будет на картинке). */
  text: string;
  /** Рисунки вопроса по порядку — встают на места пометок «[изображение]» / «[рисунок: имя]». */
  images: HTMLImageElement[];
  /** Смысл в расположении на картинке (перетаскивание на изображение): вместо рисунков — снимок вопроса целиком. */
  snapshot?: Element;
  /** Строка внизу: видео/аудио в картинку не попадают. */
  note?: string;
}

const PLACEHOLDER = /\[(?:изображение|рисунок(?::\s*([^\]]+))?)\]/g;

function fileName(img: HTMLImageElement): string {
  try {
    return decodeURIComponent(new URL(img.src).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
}

/** Рисунки вопроса в порядке появления (как в тексте). */
export function contentImages(root: Element): HTMLImageElement[] {
  return Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(
    (img) => isContentImage(img) && !/(^|\s)texrender(\s|$)/.test(img.className) && !img.closest('[data-ecx]'),
  );
}

/** Карточка: текст и рисунки на своих местах. Пометка с именем ищет рисунок по имени файла, без имени — следующий по порядку. */
export function buildCard(src: CardSource): HTMLElement {
  const card = document.createElement('div');
  Object.assign(card.style, {
    font: '400 15px/1.5 Roboto, "Segoe UI", Arial, sans-serif',
    color: '#1d2125',
    background: '#ffffff',
  } satisfies Partial<CSSStyleDeclaration>);
  const used = new Set<HTMLImageElement>();
  const nextFree = () => src.images.find((i) => !used.has(i));
  const textBlock = (t: string) => {
    if (!t.trim()) return;
    const d = document.createElement('div');
    d.textContent = t.replace(/^\n+|\n+$/g, '');
    Object.assign(d.style, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } satisfies Partial<CSSStyleDeclaration>);
    card.append(d);
  };
  const picture = (img: HTMLImageElement) => {
    used.add(img);
    // Копия картинки начинает грузиться сразу — обработчики onerror/onload со страницы убираем заранее.
    const c = neutralize(img.cloneNode(true) as HTMLImageElement);
    c.removeAttribute('width');
    c.removeAttribute('height');
    Object.assign(c.style, {
      display: 'block',
      maxWidth: '100%',
      height: 'auto',
      margin: '10px 0',
      border: '1px solid #e3e6ec',
      borderRadius: '6px',
    } satisfies Partial<CSSStyleDeclaration>);
    card.append(c);
  };

  let last = 0;
  if (!src.snapshot) {
    for (const m of src.text.matchAll(PLACEHOLDER)) {
      const name = m[1]?.trim();
      const img = (name && src.images.find((i) => !used.has(i) && (fileName(i) === name || i.alt === name))) || (!name ? nextFree() : undefined);
      if (!img) continue; // рисунок с другой страницы — пометка остаётся текстом
      textBlock(src.text.slice(last, m.index));
      picture(img);
      last = m.index! + m[0].length;
    }
  }
  textBlock(src.text.slice(last));
  if (src.snapshot) {
    const s = neutralize(src.snapshot.cloneNode(true) as HTMLElement);
    s.style.marginTop = '12px';
    card.append(s);
  } else {
    // Рисунки, для которых в тексте не нашлось пометки, — в конце, чтобы ничего не потерять.
    src.images.filter((i) => !used.has(i)).forEach(picture);
  }
  if (src.note) {
    const line = document.createElement('div');
    line.textContent = src.note;
    Object.assign(line.style, {
      margin: '14px 0 0',
      padding: '8px 12px',
      borderRadius: '8px',
      background: '#fdf1e4',
      color: '#8a4b12',
      fontWeight: '600',
    } satisfies Partial<CSSStyleDeclaration>);
    card.append(line);
  }
  return card;
}

export async function copyWithImage(src: CardSource): Promise<CopyImageResult> {
  const png = withLightTheme(() => captureQuestion(buildCard(src)))
    .then((bytes) => new Blob([bytes as BlobPart], { type: 'image/png' }))
    .finally(() => disposeRenderContainer());

  const Item = (globalThis as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (Item && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new Item({ 'image/png': png })]);
      return 'image';
    } catch {
      /* ниже — хотя бы текст */
    }
  }
  png.catch(() => {});
  return (await copyText(src.text)) ? 'text' : 'fail';
}

/** Подпись внизу картинки, если в вопросе есть то, что картинкой не передать. */
export function mediaNote(kinds: string[]): string | undefined {
  const has = (k: string) => kinds.includes(k);
  const what = [has('video') && 'видео', has('audio') && 'аудио', has('other') && 'интерактивное задание'].filter(Boolean);
  return what.length ? `В вопросе есть ${what.join(' и ')} — в картинку не попало: ответ не угадывать, сверить с материалом на странице.` : undefined;
}
